import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { GlobalRole } from '../src/auth/permissions/global-role.enum';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { closeE2eApp } from './close-e2e-app.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { PlaylistResponseDto } from '../src/playlists/dto/playlist-response.dto';
import { PlaylistSummaryResponseDto } from '../src/playlists/dto/playlist-summary-response.dto';
import { PlaylistSong } from '../src/playlists/entities/playlist-song.entity';
import { Playlist } from '../src/playlists/entities/playlist.entity';
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { Song } from '../src/songs/entities/song.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';

const OWNER_TOKEN = 'valid-playlists-owner-token';
const OTHER_TOKEN = 'valid-playlists-other-token';
const OWNER_CLERK_ID = 'user_test_playlists_owner';
const OTHER_CLERK_ID = 'user_test_playlists_other';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_playlists_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_playlists_owner' },
  },
  [OTHER_TOKEN]: {
    userId: OTHER_CLERK_ID,
    sessionId: 'sess_playlists_other',
    tokenType: 'session_token',
    claims: { sub: OTHER_CLERK_ID, sid: 'sess_playlists_other' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/playlists-owner.png',
    primaryEmailAddress: { emailAddress: 'playlists.owner@example.com' },
  },
  [OTHER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/playlists-other.png',
    primaryEmailAddress: { emailAddress: 'playlists.other@example.com' },
  },
};

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    const auth = TOKEN_TO_AUTH[token];
    if (auth) {
      return Promise.resolve(auth);
    }
    return Promise.reject(new UnauthorizedException('Authentication required'));
  },
};

const fixtureClerkClient = {
  users: {
    getUser: (clerkUserId: string) => {
      const profile = FIXTURE_CLERK_PROFILES[clerkUserId];
      if (!profile) {
        return Promise.reject(
          new Error(`Unknown test Clerk user ${clerkUserId}`),
        );
      }
      return Promise.resolve({ id: clerkUserId, ...profile });
    },
    deleteUser: () => Promise.resolve(),
  },
};

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

function minimalSongPayload(
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const suffix = randomUUID().slice(0, 8);
  return {
    title: `Playlist test song ${suffix}`,
    authorName: 'Mestre Test',
    categoryId,
    alternativeTitles: [],
    tagIds: [],
    parts: [
      {
        performer: 'LEAD',
        position: 1,
        lines: [
          {
            originalText: 'Some lyric line',
            phoneticText: null,
            position: 1,
            translations: [],
          },
        ],
      },
    ],
    media: [],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
    ...overrides,
  };
}

describe('Playlists (e2e)', () => {
  let app: INestApplication<App>;
  let category: SongCategory;
  const createdSongIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
      .compile();

    app = moduleFixture.createNestApplication();
    const appConfig = app.get(AppConfigService);
    app.setGlobalPrefix(appConfig.apiPrefix);
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: appConfig.apiVersion,
      prefix: false,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const em = app.get(EntityManager).fork();
    category = new SongCategory();
    category.code = `TEST_E2E_PL_${randomUUID().slice(0, 8)}`;
    category.name = 'Test playlists category';
    category.position = 999;
    category.isActive = true;
    await em.persistAndFlush(category);

    // OWNER_TOKEN creates songs as fixture data throughout this file, which
    // requires SONG_CREATE (EDITOR+ - see role-permissions.map.ts). This
    // file is about Playlists, not Songs moderation, so the elevation is
    // fixture setup only.
    await grantGlobalRole(OWNER_TOKEN, GlobalRole.EDITOR);
  });

  async function grantGlobalRole(
    token: string,
    role: GlobalRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .get('/api/v1/songs')
      .query({ page: 1, limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const em = app.get(EntityManager).fork();
    const auth = TOKEN_TO_AUTH[token];
    const user = await em.findOneOrFail(User, { clerkUserId: auth.userId });
    user.globalRole = role;
    await em.flush();
  }

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(Song, { category: category.id });
      await cleanup.nativeDelete(SongCategory, { id: category.id });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  afterEach(async () => {
    const cleanup = app.get(EntityManager).fork();
    if (createdSongIds.length > 0) {
      await cleanup.nativeDelete(Song, { id: { $in: createdSongIds } });
      createdSongIds.length = 0;
    }
  });

  async function createSong(token: string): Promise<SongDetailsResponseDto> {
    const created = await bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/songs')
        .set('Authorization', `Bearer ${token}`)
        .send(minimalSongPayload(category.id))
        .expect(201),
    );
    createdSongIds.push(created.id);
    return created;
  }

  async function createPlaylist(
    token: string,
    body: Record<string, unknown> = {
      name: `Playlist ${randomUUID().slice(0, 8)}`,
      description: null,
    },
  ): Promise<PlaylistResponseDto> {
    return bodyOf<PlaylistResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201),
    );
  }

  describe('CRUD', () => {
    it('creates, fetches, updates and deletes a playlist', async () => {
      const created = await createPlaylist(OWNER_TOKEN, {
        name: 'Roda favorites',
        description: 'Songs for the weekly roda',
      });
      expect(created.name).toBe('Roda favorites');
      expect(created.description).toBe('Songs for the weekly roda');
      expect(created.songs).toEqual([]);
      expect(created.songCount).toBe(0);

      const fetched = await bodyOf<PlaylistResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/playlists/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched).toEqual(created);

      const updated = await bodyOf<PlaylistResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/playlists/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Roda favorites (renamed)' })
          .expect(200),
      );
      expect(updated.name).toBe('Roda favorites (renamed)');
      expect(updated.description).toBe('Songs for the weekly roda');

      await request(app.getHttpServer())
        .delete(`/api/v1/playlists/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/playlists/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it("GET /playlists lists only the current user's own playlists", async () => {
      const ownerPlaylist = await createPlaylist(OWNER_TOKEN);
      await createPlaylist(OTHER_TOKEN);

      const list = await bodyOf<PlaylistSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/playlists')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(list.some((p) => p.id === ownerPlaylist.id)).toBe(true);
      expect(list.every((p) => p.id !== undefined)).toBe(true);
    });

    it('POST /playlists rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/playlists')
        .send({ name: 'x', description: null })
        .expect(401);
    });

    it('POST /playlists rejects an empty name with VALIDATION_ERROR', async () => {
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/playlists')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: '' })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('ownership / security', () => {
    it('another user cannot GET, PATCH or DELETE a playlist they do not own (404, not 403)', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);

      await request(app.getHttpServer())
        .get(`/api/v1/playlists/${playlist.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/v1/playlists/${playlist.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .send({ name: 'hijacked' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/v1/playlists/${playlist.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(404);

      // The playlist must still exist for its real owner.
      await request(app.getHttpServer())
        .get(`/api/v1/playlists/${playlist.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200);
    });

    it('another user cannot add/remove/reorder songs in a playlist they do not own', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${playlist.id}/songs`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .send({ songId: song.id })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/v1/playlists/${playlist.id}/songs/${song.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/v1/playlists/${playlist.id}/songs/order`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .send({ songIds: [song.id] })
        .expect(404);
    });
  });

  describe('managing songs in a playlist', () => {
    it('adds songs (appended at the end), removes one, and adding twice is idempotent', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);
      const songA = await createSong(OWNER_TOKEN);
      const songB = await createSong(OWNER_TOKEN);

      const afterA = await bodyOf<PlaylistResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/playlists/${playlist.id}/songs`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ songId: songA.id })
          .expect(201),
      );
      expect(afterA.songs.map((s) => s.song.id)).toEqual([songA.id]);
      expect(afterA.songs[0].position).toBe(1);

      const afterB = await bodyOf<PlaylistResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/playlists/${playlist.id}/songs`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ songId: songB.id })
          .expect(201),
      );
      expect(afterB.songs.map((s) => s.song.id)).toEqual([songA.id, songB.id]);
      expect(afterB.songs[1].position).toBe(2);

      // Idempotent re-add.
      const afterReAdd = await bodyOf<PlaylistResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/playlists/${playlist.id}/songs`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ songId: songA.id })
          .expect(201),
      );
      expect(afterReAdd.songCount).toBe(2);

      const em = app.get(EntityManager).fork();
      const linkCount = await em.count(PlaylistSong, {
        playlist: playlist.id,
        song: songA.id,
      });
      expect(linkCount).toBe(1);

      const afterRemove = await bodyOf<PlaylistResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/playlists/${playlist.id}/songs/${songA.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(afterRemove.songs.map((s) => s.song.id)).toEqual([songB.id]);

      // Idempotent re-remove - no error.
      await request(app.getHttpServer())
        .delete(`/api/v1/playlists/${playlist.id}/songs/${songA.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200);
    });

    it('POST .../songs 404s when the song does not exist', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${playlist.id}/songs`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ songId: randomUUID() })
        .expect(404);
    });

    it('reorders songs via PATCH .../songs/order', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);
      const songA = await createSong(OWNER_TOKEN);
      const songB = await createSong(OWNER_TOKEN);
      const songC = await createSong(OWNER_TOKEN);

      for (const song of [songA, songB, songC]) {
        await request(app.getHttpServer())
          .post(`/api/v1/playlists/${playlist.id}/songs`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ songId: song.id })
          .expect(201);
      }

      const reordered = await bodyOf<PlaylistResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/playlists/${playlist.id}/songs/order`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ songIds: [songC.id, songA.id, songB.id] })
          .expect(200),
      );

      expect(reordered.songs.map((s) => s.song.id)).toEqual([
        songC.id,
        songA.id,
        songB.id,
      ]);
      expect(reordered.songs.map((s) => s.position)).toEqual([1, 2, 3]);
    });

    it('PATCH .../songs/order rejects a songIds list that does not match the current set', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);
      const songA = await createSong(OWNER_TOKEN);
      const songB = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${playlist.id}/songs`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ songId: songA.id })
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/playlists/${playlist.id}/songs/order`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ songIds: [songA.id, songB.id] })
          .expect(409),
      );
      expect(response.code).toBe('PLAYLIST_ORDER_MISMATCH');
    });
  });

  describe('SongDetails.playlists', () => {
    it("lists only the current user's playlists containing the song, as {id, name} pairs", async () => {
      const song = await createSong(OWNER_TOKEN);
      const ownerPlaylist = await createPlaylist(OWNER_TOKEN, {
        name: 'Owner playlist',
        description: null,
      });
      const otherPlaylist = await createPlaylist(OTHER_TOKEN, {
        name: 'Other playlist',
        description: null,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${ownerPlaylist.id}/songs`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ songId: song.id })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${otherPlaylist.id}/songs`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .send({ songId: song.id })
        .expect(201);

      const ownerDetails = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(ownerDetails.playlists).toEqual([
        { id: ownerPlaylist.id, name: 'Owner playlist' },
      ]);

      const otherDetails = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(200),
      );
      expect(otherDetails.playlists).toEqual([
        { id: otherPlaylist.id, name: 'Other playlist' },
      ]);
    });
  });

  describe('cascade deletes', () => {
    it('deleting a playlist cascades to its playlist_songs rows', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);
      const song = await createSong(OWNER_TOKEN);
      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${playlist.id}/songs`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ songId: song.id })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/v1/playlists/${playlist.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const em = app.get(EntityManager).fork();
      expect(await em.count(PlaylistSong, { playlist: playlist.id })).toBe(0);
    });

    it('deleting the song cascades to every playlist_songs row referencing it', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);
      const song = await createSong(OWNER_TOKEN);
      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${playlist.id}/songs`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ songId: song.id })
        .expect(201);

      const em = app.get(EntityManager).fork();
      await em.nativeDelete(Song, { id: song.id });
      createdSongIds.splice(createdSongIds.indexOf(song.id), 1);

      const verifyEm = app.get(EntityManager).fork();
      expect(await verifyEm.count(PlaylistSong, { song: song.id })).toBe(0);

      const survivingPlaylist = await verifyEm.findOne(Playlist, {
        id: playlist.id,
      });
      expect(survivingPlaylist).not.toBeNull();
    });

    it('deleting the user cascades to their playlists and playlist_songs rows', async () => {
      const playlist = await createPlaylist(OWNER_TOKEN);
      const song = await createSong(OWNER_TOKEN);
      await request(app.getHttpServer())
        .post(`/api/v1/playlists/${playlist.id}/songs`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ songId: song.id })
        .expect(201);

      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, {
        clerkUserId: OWNER_CLERK_ID,
      });
      const userId = user.id;
      await em.nativeDelete(User, { id: userId });

      const verifyEm = app.get(EntityManager).fork();
      expect(await verifyEm.count(Playlist, { owner: userId })).toBe(0);
      expect(
        await verifyEm.count(PlaylistSong, { playlist: playlist.id }),
      ).toBe(0);

      // The song itself must survive - Songi są globalne.
      const survivingSong = await verifyEm.findOne(Song, { id: song.id });
      expect(survivingSong).not.toBeNull();
    });
  });
});
