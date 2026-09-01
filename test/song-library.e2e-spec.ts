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
import { FavoriteSongsListResponseDto } from '../src/song-library/dto/favorite-songs-list-response.dto';
import { LearningSongsListResponseDto } from '../src/song-library/dto/learning-songs-list-response.dto';
import { FavoriteSong } from '../src/song-library/entities/favorite-song.entity';
import { SongNote } from '../src/song-library/entities/song-note.entity';
import { UserSongLearning } from '../src/song-library/entities/user-song-learning.entity';
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { Song } from '../src/songs/entities/song.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';

const OWNER_TOKEN = 'valid-library-owner-token';
const OTHER_TOKEN = 'valid-library-other-token';
const OWNER_CLERK_ID = 'user_test_library_owner';
const OTHER_CLERK_ID = 'user_test_library_other';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_library_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_library_owner' },
  },
  [OTHER_TOKEN]: {
    userId: OTHER_CLERK_ID,
    sessionId: 'sess_library_other',
    tokenType: 'session_token',
    claims: { sub: OTHER_CLERK_ID, sid: 'sess_library_other' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/library-owner.png',
    primaryEmailAddress: { emailAddress: 'library.owner@example.com' },
  },
  [OTHER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/library-other.png',
    primaryEmailAddress: { emailAddress: 'library.other@example.com' },
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
    title: `Library test song ${suffix}`,
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

describe('Song library (e2e) - favorites, learning status, notes', () => {
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
    category.code = `TEST_E2E_LIB_${randomUUID().slice(0, 8)}`;
    category.name = 'Test library category';
    category.position = 999;
    category.isActive = true;
    await em.persistAndFlush(category);

    // OWNER_TOKEN creates songs as fixture data throughout this file, which
    // requires SONG_CREATE (EDITOR+ - see role-permissions.map.ts). This
    // file is about the song-library aggregate (favorites/learning-status/
    // notes), not Songs moderation, so the elevation is fixture setup only.
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

  // Every song this file creates is a private DRAFT (never submitted or
  // published - see createSong) that only its own creator can see, so
  // fetching it goes through GET /songs/my-submissions/:id, not the public
  // GET /songs/:id (PUBLISHED-only - see the songbook visibility rule).
  // Every call site below passes the song's own creator as `token`.
  async function getSongDetails(
    token: string,
    songId: string,
  ): Promise<SongDetailsResponseDto> {
    return bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/songs/my-submissions/${songId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  describe('favorites', () => {
    it('adds a favorite, reflects it in SongDetails.isFavorite and the favorite-songs list, then removes it', async () => {
      const song = await createSong(OWNER_TOKEN);

      const before = await getSongDetails(OWNER_TOKEN, song.id);
      expect(before.isFavorite).toBe(false);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const after = await getSongDetails(OWNER_TOKEN, song.id);
      expect(after.isFavorite).toBe(true);

      const list = await bodyOf<FavoriteSongsListResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/favorite-songs')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.items.some((item) => item.id === song.id)).toBe(true);

      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const removed = await getSongDetails(OWNER_TOKEN, song.id);
      expect(removed.isFavorite).toBe(false);
    });

    it('favoriting an already-favorited song is idempotent, not a conflict', async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const em = app.get(EntityManager).fork();
      const count = await em.count(FavoriteSong, {
        song: song.id,
        user: { clerkUserId: OWNER_CLERK_ID },
      });
      expect(count).toBe(1);
    });

    it('unfavoriting a song that was never favorited is a no-op 204', async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });

    it("does not leak one user's favorite to another user's SongDetails/list", async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      // OTHER_TOKEN cannot see this DRAFT song's details at all - not even
      // to discover whether its owner favorited it (see the songbook
      // visibility rule: a DRAFT is invisible to everyone but its creator).
      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(404);

      const otherList = await bodyOf<FavoriteSongsListResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/favorite-songs')
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(200),
      );
      expect(otherList.items.some((item) => item.id === song.id)).toBe(false);
    });

    it('POST /songs/:songId/favorite requires authentication', async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/favorite`)
        .expect(401);
    });
  });

  describe('learning status', () => {
    it('sets, updates, and removes the learning status, reflected in SongDetails and the learning-songs list', async () => {
      const song = await createSong(OWNER_TOKEN);

      const before = await getSongDetails(OWNER_TOKEN, song.id);
      expect(before.learningStatus).toBeNull();

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/learning-status`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ status: 'LEARNING' })
        .expect(200);

      const afterSet = await getSongDetails(OWNER_TOKEN, song.id);
      expect(afterSet.learningStatus).toBe('LEARNING');

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/learning-status`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ status: 'MASTERED' })
        .expect(200);

      const afterUpdate = await getSongDetails(OWNER_TOKEN, song.id);
      expect(afterUpdate.learningStatus).toBe('MASTERED');

      const list = await bodyOf<LearningSongsListResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/learning-songs')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const listItem = list.items.find((item) => item.id === song.id);
      expect(listItem?.learningStatus).toBe('MASTERED');

      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/learning-status`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const afterDelete = await getSongDetails(OWNER_TOKEN, song.id);
      expect(afterDelete.learningStatus).toBeNull();
    });

    it('rejects an invalid status value with VALIDATION_ERROR', async () => {
      const song = await createSong(OWNER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/songs/${song.id}/learning-status`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ status: 'NOT_A_REAL_STATUS' })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it("does not leak one user's learning status to another user", async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/learning-status`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ status: 'CAN_LEAD' })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(404);
    });

    it('removing a status that was never set is a no-op 204', async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/learning-status`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });
  });

  describe('private notes', () => {
    it('creates, reads, updates (upsert) and deletes a note, reflected in SongDetails.myNote', async () => {
      const song = await createSong(OWNER_TOKEN);

      const emptyNote = await bodyOf<{
        songId: string;
        content: string | null;
      }>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}/my-note`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(emptyNote.content).toBeNull();

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/my-note`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ content: 'First version' })
        .expect(200);

      const afterCreate = await getSongDetails(OWNER_TOKEN, song.id);
      expect(afterCreate.myNote).toBe('First version');

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/my-note`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ content: 'Updated version' })
        .expect(200);

      const afterUpdate = await getSongDetails(OWNER_TOKEN, song.id);
      expect(afterUpdate.myNote).toBe('Updated version');

      const em = app.get(EntityManager).fork();
      const noteCount = await em.count(SongNote, { song: song.id });
      expect(noteCount).toBe(1);

      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/my-note`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const afterDelete = await getSongDetails(OWNER_TOKEN, song.id);
      expect(afterDelete.myNote).toBeNull();
    });

    it('rejects an empty note body with VALIDATION_ERROR', async () => {
      const song = await createSong(OWNER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/songs/${song.id}/my-note`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ content: '' })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it("does not leak one user's note to another user", async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/my-note`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ content: 'Secret note' })
        .expect(200);

      const otherNote = await bodyOf<{ content: string | null }>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}/my-note`)
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(200),
      );
      expect(otherNote.content).toBeNull();

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(404);
    });

    it('deleting a note that never existed is a no-op 204', async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/my-note`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });
  });

  describe('cascade deletes', () => {
    it('deleting the song cascades to its favorites, learning status and notes', async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/learning-status`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ status: 'LEARNING' })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/my-note`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ content: 'note before delete' })
        .expect(200);

      const em = app.get(EntityManager).fork();
      await em.nativeDelete(Song, { id: song.id });
      createdSongIds.splice(createdSongIds.indexOf(song.id), 1);

      const verifyEm = app.get(EntityManager).fork();
      expect(await verifyEm.count(FavoriteSong, { song: song.id })).toBe(0);
      expect(await verifyEm.count(UserSongLearning, { song: song.id })).toBe(0);
      expect(await verifyEm.count(SongNote, { song: song.id })).toBe(0);
    });

    it('deleting the user cascades to their favorites, learning status and notes', async () => {
      const song = await createSong(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/favorite`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/learning-status`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ status: 'LEARNING' })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/my-note`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ content: 'note before user delete' })
        .expect(200);

      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, {
        clerkUserId: OWNER_CLERK_ID,
      });
      const userId = user.id;
      await em.nativeDelete(User, { id: userId });

      const verifyEm = app.get(EntityManager).fork();
      expect(await verifyEm.count(FavoriteSong, { user: userId })).toBe(0);
      expect(await verifyEm.count(UserSongLearning, { user: userId })).toBe(0);
      expect(await verifyEm.count(SongNote, { user: userId })).toBe(0);

      // The song itself must survive - Songi są globalne, only the
      // user-owned rows are cascaded.
      const survivingSong = await verifyEm.findOne(Song, { id: song.id });
      expect(survivingSong).not.toBeNull();
    });
  });
});
