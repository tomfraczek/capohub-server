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
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { DuplicateSuggestionsResponseDto } from '../src/songs/dto/duplicate-suggestion-response.dto';
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { SongMediaDetailsResponseDto } from '../src/songs/dto/song-media-details-response.dto';
import { SongMediaVoteResponseDto } from '../src/songs/dto/song-media-vote-response.dto';
import { SongSummaryResponseDto } from '../src/songs/dto/song-summary-response.dto';
import { Song } from '../src/songs/entities/song.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';
import { SongMediaVote } from '../src/songs/entities/song-media-vote.entity';
import { SongTag } from '../src/songs/entities/song-tag.entity';
import { Tag } from '../src/songs/entities/tag.entity';

const OWNER_TOKEN = 'valid-songs-owner-token';
const OTHER_TOKEN = 'valid-songs-other-token';
const MODERATOR_TOKEN = 'valid-songs-moderator-token';
// Deliberately never elevated - stays at the default globalRole USER for
// the lifetime of this file, so tests can assert what a completely
// unprivileged (but authenticated) account can and cannot do (see the
// moderation model: SONG_CREATE/SONG_EDIT_*/CONTENT_* are all EDITOR+).
const PLAIN_USER_TOKEN = 'valid-songs-plain-user-token';
const OWNER_CLERK_ID = 'user_test_songs_owner';
const OTHER_CLERK_ID = 'user_test_songs_other';
const MODERATOR_CLERK_ID = 'user_test_songs_moderator';
const PLAIN_USER_CLERK_ID = 'user_test_songs_plain_user';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_songs_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_songs_owner' },
  },
  [OTHER_TOKEN]: {
    userId: OTHER_CLERK_ID,
    sessionId: 'sess_songs_other',
    tokenType: 'session_token',
    claims: { sub: OTHER_CLERK_ID, sid: 'sess_songs_other' },
  },
  [MODERATOR_TOKEN]: {
    userId: MODERATOR_CLERK_ID,
    sessionId: 'sess_songs_moderator',
    tokenType: 'session_token',
    claims: { sub: MODERATOR_CLERK_ID, sid: 'sess_songs_moderator' },
  },
  [PLAIN_USER_TOKEN]: {
    userId: PLAIN_USER_CLERK_ID,
    sessionId: 'sess_songs_plain_user',
    tokenType: 'session_token',
    claims: { sub: PLAIN_USER_CLERK_ID, sid: 'sess_songs_plain_user' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/songs-owner.png',
    primaryEmailAddress: { emailAddress: 'songs.owner@example.com' },
  },
  [OTHER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/songs-other.png',
    primaryEmailAddress: { emailAddress: 'songs.other@example.com' },
  },
  [MODERATOR_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/songs-moderator.png',
    primaryEmailAddress: { emailAddress: 'songs.moderator@example.com' },
  },
  [PLAIN_USER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/songs-plain-user.png',
    primaryEmailAddress: { emailAddress: 'songs.plain.user@example.com' },
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
    title: `Paranauê ${suffix}`,
    authorName: 'Mestre Test',
    categoryId,
    alternativeTitles: [{ title: `Paraná ${suffix}`, position: 1 }],
    tagIds: [],
    parts: [
      {
        performer: 'CHORUS',
        position: 1,
        lines: [
          {
            originalText: 'Paranauê, paranauê Paraná',
            position: 1,
            phonetics: [{ languageCode: 'pt', text: 'Paranau-e' }],
            translations: [{ languageCode: 'pl', text: 'Tłumaczenie chorus' }],
          },
        ],
      },
      {
        performer: 'LEAD',
        position: 2,
        lines: [
          {
            originalText: 'Meu mestre mandou chamar',
            position: 1,
            phonetics: [],
            translations: [],
          },
        ],
      },
    ],
    media: [
      {
        provider: 'YOUTUBE',
        url: `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`,
        title: 'Wersja koncertowa',
        position: 1,
      },
    ],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
    ...overrides,
  };
}

describe('Songs (e2e)', () => {
  let app: INestApplication<App>;
  let category: SongCategory;
  let secondCategory: SongCategory;
  const createdSongIds: string[] = [];
  const createdTagIds: string[] = [];

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
    category.code = `TEST_E2E_${randomUUID().slice(0, 8)}`;
    category.name = 'Test category';
    category.position = 999;
    category.isActive = true;

    secondCategory = new SongCategory();
    secondCategory.code = `TEST_E2E_2_${randomUUID().slice(0, 8)}`;
    secondCategory.name = 'Second test category';
    secondCategory.position = 998;
    secondCategory.isActive = true;

    await em.persistAndFlush([category, secondCategory]);

    // OWNER_TOKEN/OTHER_TOKEN create, edit and submit their own songs
    // throughout this file, which requires SONG_CREATE/SONG_EDIT_OWN
    // (EDITOR+ - see role-permissions.map.ts); MODERATOR_TOKEN approves/
    // rejects/hides/restores content and verifies media, which requires
    // CONTENT_APPROVE/CONTENT_HIDE (MODERATOR+). PLAIN_USER_TOKEN is
    // deliberately left at the default USER tier - see its own comment.
    await grantGlobalRole(OWNER_TOKEN, GlobalRole.EDITOR);
    await grantGlobalRole(OTHER_TOKEN, GlobalRole.EDITOR);
    await grantGlobalRole(MODERATOR_TOKEN, GlobalRole.MODERATOR);
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(Song, {
        category: { $in: [category.id, secondCategory.id] },
      });
      await cleanup.nativeDelete(SongCategory, {
        id: { $in: [category.id, secondCategory.id] },
      });
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
    if (createdTagIds.length > 0) {
      await cleanup.nativeDelete(Tag, { id: { $in: createdTagIds } });
      createdTagIds.length = 0;
    }
  });

  async function createTag(name: string): Promise<Tag> {
    const fork = app.get(EntityManager).fork();
    const tag = new Tag();
    tag.name = name;
    tag.slug = name;
    tag.isActive = true;
    await fork.persistAndFlush(tag);
    createdTagIds.push(tag.id);
    return tag;
  }

  async function createSong(
    token: string,
    payload: Record<string, unknown>,
  ): Promise<SongDetailsResponseDto> {
    const created = await bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/songs')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201),
    );
    createdSongIds.push(created.id);
    return created;
  }

  // publisherToken defaults to MODERATOR_TOKEN, never submitterToken - the
  // song's own creator can never self-approve their own submission (see
  // SongsService.assertNotSelfApproval). Every existing call site that
  // passes just (token, id) therefore now gets its song published by
  // MODERATOR_TOKEN, exactly as a real moderation workflow requires.
  async function publishSong(
    submitterToken: string,
    id: string,
    publisherToken: string = MODERATOR_TOKEN,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/submit`)
      .set('Authorization', `Bearer ${submitterToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/publish`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .expect(201);
  }

  async function listSongs(
    token: string,
    query: Record<string, string | number>,
  ): Promise<PaginatedResponse<SongSummaryResponseDto>> {
    return bodyOf<PaginatedResponse<SongSummaryResponseDto>>(
      request(app.getHttpServer())
        .get('/api/v1/songs')
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  // Sets globalRole directly through the EntityManager fixture, never
  // through a public endpoint (there is none - globalRole is never
  // settable via the API, see UserService). The first authenticated
  // request is what creates the local User row via findOrCreateFromClerk,
  // so it must happen before we can look the row up - safe to call more
  // than once per token (idempotent).
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

  async function grantContentApprove(token: string): Promise<void> {
    await grantGlobalRole(token, GlobalRole.MODERATOR);
  }

  // Public songbook detail - PUBLISHED only (see
  // SongsService.getPublicDetails). Never use this for a DRAFT/
  // PENDING_REVIEW/REJECTED/HIDDEN fixture, even the caller's own - use
  // getMySubmissionDetails or getModerationDetails instead.
  async function getSongDetails(
    token: string,
    songId: string,
  ): Promise<SongDetailsResponseDto> {
    return bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/songs/${songId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  // The caller's own private submission - GET /songs/my-submissions/:id.
  async function getMySubmissionDetails(
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

  // A moderator's unrestricted view of any song - GET
  // /moderation/songs/:id (CONTENT_APPROVE required).
  async function getModerationDetails(
    token: string,
    songId: string,
  ): Promise<SongDetailsResponseDto> {
    return bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/moderation/songs/${songId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function listMySubmissions(
    token: string,
    query: Record<string, string | number> = {},
  ): Promise<PaginatedResponse<SongSummaryResponseDto>> {
    return bodyOf<PaginatedResponse<SongSummaryResponseDto>>(
      request(app.getHttpServer())
        .get('/api/v1/songs/my-submissions')
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function listModerationQueue(
    token: string,
    query: Record<string, string | number> = {},
  ): Promise<PaginatedResponse<SongSummaryResponseDto>> {
    return bodyOf<PaginatedResponse<SongSummaryResponseDto>>(
      request(app.getHttpServer())
        .get('/api/v1/moderation/songs')
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function voteFor(
    token: string,
    songId: string,
    mediaId: string,
  ): Promise<SongMediaVoteResponseDto> {
    return bodyOf<SongMediaVoteResponseDto>(
      request(app.getHttpServer())
        .put(`/api/v1/songs/${songId}/media/${mediaId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  // A single-part, single-line payload with a fully controlled title and
  // first line - unlike minimalSongPayload's random title suffix, tests in
  // the "duplicate detection" block need two songs to genuinely share (or
  // deliberately differ in) their title/first line.
  function duplicateTestPayload(
    categoryId: string,
    title: string,
    firstLine: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return minimalSongPayload(categoryId, {
      title,
      alternativeTitles: [],
      parts: [
        {
          performer: 'LEAD',
          position: 1,
          lines: [
            {
              originalText: firstLine,
              position: 1,
              phonetics: [],
              translations: [],
            },
          ],
        },
      ],
      media: [],
      ...overrides,
    });
  }

  async function getDuplicateSuggestions(
    token: string,
    title: string,
    limit?: number,
  ): Promise<DuplicateSuggestionsResponseDto> {
    const query: Record<string, string> = { title };
    if (limit !== undefined) {
      query.limit = String(limit);
    }
    return bodyOf<DuplicateSuggestionsResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/songs/duplicate-suggestions')
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  describe('CRUD', () => {
    it('creates a song, fetches full details, and replaces it wholesale via PATCH', async () => {
      const tag = await createTag(`e2e-tag-${randomUUID().slice(0, 8)}`);
      const payload = minimalSongPayload(category.id, { tagIds: [tag.id] });

      const created = await createSong(OWNER_TOKEN, payload);

      expect(created).toMatchObject({
        title: payload.title,
        status: 'DRAFT',
        category: { code: category.code },
      });
      expect(created.createdBy?.displayName).toBeDefined();
      expect(created.media[0].isVerified).toBe(false);
      expect(created.parts).toHaveLength(2);
      expect(created.parts[0].position).toBe(1);
      expect(created.parts[1].position).toBe(2);
      expect(created.parts[0].lines[0].translations[0].languageCode).toBe('pl');
      expect(created.parts[0].lines[0].phonetics[0]).toMatchObject({
        languageCode: 'pt',
        text: 'Paranau-e',
      });

      const songId = created.id;

      // Still DRAFT at this point - fetched via GET
      // /songs/my-submissions/:id, not the public GET /songs/:id (which
      // 404s for anything but PUBLISHED, even for the song's own creator -
      // see the "GET /songs/:id visibility" describe block below).
      const fetched = await getMySubmissionDetails(OWNER_TOKEN, songId);
      expect(fetched).toEqual(created);

      const newTag = await createTag(
        `e2e-tag-updated-${randomUUID().slice(0, 8)}`,
      );
      const updatedPayload = minimalSongPayload(category.id, {
        title: 'Completely different title',
        tagIds: [newTag.id],
        parts: [
          {
            performer: 'LEAD',
            position: 1,
            lines: [
              {
                originalText: 'Only one line now',
                position: 1,
                phonetics: [],
                translations: [],
              },
            ],
          },
        ],
        media: [],
      });

      const patched = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/songs/${songId}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(updatedPayload)
          .expect(200),
      );

      expect(patched.title).toBe('Completely different title');
      expect(patched.parts).toHaveLength(1);
      expect(patched.media).toHaveLength(0);
      expect(patched.tags).toHaveLength(1);
      expect(patched.tags[0].id).toBe(newTag.id);
      expect(patched.status).toBe('DRAFT');
      expect(patched.createdAt).toBe(created.createdAt);
      expect(patched.createdBy?.id).toBe(created.createdBy?.id);

      const verifyEm = app.get(EntityManager).fork();
      const oldTagLinkCount = await verifyEm.count(SongTag, {
        tag: tag.id,
        song: songId,
      });
      expect(oldTagLinkCount).toBe(0);
    });

    it('POST /songs rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/songs')
        .send(minimalSongPayload(category.id))
        .expect(401);
    });

    it('GET /songs/:id returns 404 for a non-existent id', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/songs/${randomUUID()}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it('POST /songs rejects an invalid body with a VALIDATION_ERROR, not a raw DB error', async () => {
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/songs')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ title: '' })
          .expect(400),
      );

      expect(response.code).toBe('VALIDATION_ERROR');
    });
  });

  // GET /songs/:id is the public songbook's detail view - PUBLISHED only,
  // 404 for everything else, for every caller including the song's own
  // creator and a MODERATOR+ (who instead uses GET /moderation/songs/:id -
  // see the "moderation queue" describe block).
  describe('GET /songs/:id visibility', () => {
    it('returns 200 for a PUBLISHED song', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OWNER_TOKEN, song.id);

      const details = await getSongDetails(OWNER_TOKEN, song.id);
      expect(details.status).toBe('PUBLISHED');
    });

    it('returns 404 for DRAFT, even for its own creator', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it('returns 404 for PENDING_REVIEW, even for a MODERATOR', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(404);
    });

    it('returns 404 for REJECTED', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Not ready' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it('returns 404 for HIDDEN, even for a MODERATOR', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OWNER_TOKEN, song.id);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/hide`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(404);
    });
  });

  describe('list', () => {
    it('paginates results using the standard PaginatedResponse shape', async () => {
      const first = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const second = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OWNER_TOKEN, first.id);
      await publishSong(OWNER_TOKEN, second.id);

      const response = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 1,
        createdByMe: 'true',
      });

      expect(response.data).toHaveLength(1);
      expect(response.meta).toMatchObject({ page: 1, limit: 1 });
      expect(response.meta.totalItems).toBeGreaterThanOrEqual(2);
      expect(response.meta.hasNextPage).toBe(true);
    });

    // The central regression test for the moderation model: GET /songs is
    // the public songbook, so it must show PUBLISHED and nothing else -
    // not the caller's own DRAFT/PENDING_REVIEW/REJECTED, not another
    // user's, and never HIDDEN - regardless of the caller's globalRole.
    // Run for both a plain USER and a MODERATOR to prove the rule is not
    // role-dependent (see songs-list-query.ts's applyVisibility).
    it.each([
      ['USER', PLAIN_USER_TOKEN] as const,
      ['MODERATOR', MODERATOR_TOKEN] as const,
    ])(
      'GET /songs returns PUBLISHED songs only, for %s too',
      async (_label, viewerToken) => {
        const draftSong = await createSong(
          PLAIN_USER_TOKEN,
          minimalSongPayload(category.id),
        );

        const pendingSong = await createSong(
          PLAIN_USER_TOKEN,
          minimalSongPayload(category.id),
        );
        await request(app.getHttpServer())
          .post(`/api/v1/songs/${pendingSong.id}/submit`)
          .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
          .expect(201);

        const rejectedSong = await createSong(
          PLAIN_USER_TOKEN,
          minimalSongPayload(category.id),
        );
        await request(app.getHttpServer())
          .post(`/api/v1/songs/${rejectedSong.id}/submit`)
          .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/songs/${rejectedSong.id}/reject`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ reason: 'Needs work' })
          .expect(201);

        const publishedSong = await createSong(
          PLAIN_USER_TOKEN,
          minimalSongPayload(category.id),
        );
        await publishSong(PLAIN_USER_TOKEN, publishedSong.id);

        const hiddenSong = await createSong(
          PLAIN_USER_TOKEN,
          minimalSongPayload(category.id),
        );
        await publishSong(PLAIN_USER_TOKEN, hiddenSong.id);
        await request(app.getHttpServer())
          .post(`/api/v1/songs/${hiddenSong.id}/hide`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(201);

        const response = await listSongs(viewerToken, { page: 1, limit: 50 });
        const ids = response.data.map((s) => s.id);

        expect(ids).toContain(publishedSong.id);
        expect(ids).not.toContain(draftSong.id);
        expect(ids).not.toContain(pendingSong.id);
        expect(ids).not.toContain(rejectedSong.id);
        expect(ids).not.toContain(hiddenSong.id);
      },
    );

    // createdByMe=true is the one documented exception to the rule above -
    // the caller's own songs of any status are visible to them here (see
    // queryVisibleSongIds's own comment), the same subset GET
    // /songs/my-submissions already exposes via its own endpoint.
    it("GET /songs?createdByMe=true returns the caller's own songs of every status, never another user's", async () => {
      const ownDraft = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const ownPublished = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OWNER_TOKEN, ownPublished.id);

      const othersDraft = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );

      const response = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        createdByMe: 'true',
      });
      const ids = response.data.map((s) => s.id);

      expect(ids).toContain(ownDraft.id);
      expect(ids).toContain(ownPublished.id);
      expect(ids).not.toContain(othersDraft.id);
    });

    // The frontend's own "Tylko moje piosenki" + Status filter combo
    // (SongFiltersModal) relies on exactly this: status narrows the
    // createdByMe=true set instead of being silently ignored.
    it("GET /songs?createdByMe=true&status=X narrows to the caller's own songs in that status only", async () => {
      const ownRejected = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${ownRejected.id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${ownRejected.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Needs work' })
        .expect(201);

      const ownDraft = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      const othersRejected = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${othersRejected.id}/submit`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${othersRejected.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Needs work' })
        .expect(201);

      const response = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        createdByMe: 'true',
        status: 'REJECTED',
      });
      const ids = response.data.map((s) => s.id);

      expect(ids).toContain(ownRejected.id);
      expect(ids).not.toContain(ownDraft.id);
      expect(ids).not.toContain(othersRejected.id);
    });

    // A non-PUBLISHED `status` implicitly means "my own songs" even
    // without createdByMe=true - there is no one else's DRAFT/
    // PENDING_REVIEW/REJECTED/HIDDEN song this endpoint could ever show, so
    // SongFiltersModal's Status picker must work standalone (this is what
    // the frontend actually sends - see song-filters-modal.tsx).
    it("GET /songs?status=X (no createdByMe) still scopes to the caller's own songs, never another user's", async () => {
      const ownRejected = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${ownRejected.id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${ownRejected.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Needs work' })
        .expect(201);

      const othersRejected = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${othersRejected.id}/submit`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${othersRejected.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Needs work' })
        .expect(201);

      const response = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        status: 'REJECTED',
      });
      const ids = response.data.map((s) => s.id);

      expect(ids).toContain(ownRejected.id);
      expect(ids).not.toContain(othersRejected.id);
    });

    // status=PUBLISHED (explicit or by omission) is the one status value
    // that never implies "my own" - it's just the routine public songbook
    // view, same as no filter at all.
    it('GET /songs?status=PUBLISHED (no createdByMe) is the normal public view, not scoped to the caller', async () => {
      const othersPublished = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OTHER_TOKEN, othersPublished.id);

      const response = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        status: 'PUBLISHED',
      });

      expect(response.data.map((s) => s.id)).toContain(othersPublished.id);
    });

    it('search matches title, alternativeTitles.title, authorName, and line originalText', async () => {
      const marker = randomUUID().slice(0, 8);

      const byTitle = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          title: `TitleMarker-${marker}`,
          alternativeTitles: [],
        }),
      );
      const byAltTitle = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          alternativeTitles: [{ title: `AltMarker-${marker}`, position: 1 }],
        }),
      );
      const byAuthor = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          authorName: `AuthorMarker-${marker}`,
          alternativeTitles: [],
        }),
      );
      const byLine = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          alternativeTitles: [],
          parts: [
            {
              performer: 'LEAD',
              position: 1,
              lines: [
                {
                  originalText: `LineMarker-${marker}`,
                  position: 1,
                  phonetics: [],
                  translations: [],
                },
              ],
            },
          ],
        }),
      );

      // GET /songs only searches PUBLISHED content (see the songbook
      // visibility rule) - every fixture must be published first.
      await publishSong(OWNER_TOKEN, byTitle.id);
      await publishSong(OWNER_TOKEN, byAltTitle.id);
      await publishSong(OWNER_TOKEN, byAuthor.id);
      await publishSong(OWNER_TOKEN, byLine.id);

      const cases: [string, string][] = [
        [`titlemarker-${marker}`, byTitle.id],
        [`altmarker-${marker}`, byAltTitle.id],
        [`authormarker-${marker}`, byAuthor.id],
        [`linemarker-${marker}`, byLine.id],
      ];

      for (const [needle, expectedId] of cases) {
        const response = await listSongs(OWNER_TOKEN, {
          page: 1,
          limit: 50,
          search: needle,
          createdByMe: 'true',
        });

        expect(response.data.map((s) => s.id)).toEqual([expectedId]);
      }
    });

    it('filters by categoryId', async () => {
      const inCategory = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const inOtherCategory = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(secondCategory.id),
      );
      await publishSong(OWNER_TOKEN, inCategory.id);
      await publishSong(OWNER_TOKEN, inOtherCategory.id);

      const response = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        categoryId: category.id,
        createdByMe: 'true',
      });

      const ids = response.data.map((s) => s.id);
      expect(ids).toContain(inCategory.id);
      expect(ids).not.toContain(inOtherCategory.id);
    });

    it('filters tagIds with AND semantics', async () => {
      const tagA = await createTag(`e2e-and-a-${randomUUID().slice(0, 8)}`);
      const tagB = await createTag(`e2e-and-b-${randomUUID().slice(0, 8)}`);

      const both = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, { tagIds: [tagA.id, tagB.id] }),
      );
      const onlyA = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, { tagIds: [tagA.id] }),
      );
      await publishSong(OWNER_TOKEN, both.id);
      await publishSong(OWNER_TOKEN, onlyA.id);

      const response = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        tagIds: `${tagA.id},${tagB.id}`,
        createdByMe: 'true',
      });

      const ids = response.data.map((s) => s.id);
      expect(ids).toContain(both.id);
      expect(ids).not.toContain(onlyA.id);
    });

    it('filters hasPhonetics, hasMedia, hasTranslation and translationLanguage', async () => {
      const withEverything = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          parts: [
            {
              performer: 'LEAD',
              position: 1,
              lines: [
                {
                  originalText: 'Has phonetics and pl translation',
                  position: 1,
                  phonetics: [{ languageCode: 'pt', text: 'fonetyka' }],
                  translations: [{ languageCode: 'pl', text: 'a' }],
                },
              ],
            },
          ],
          media: [
            {
              provider: 'YOUTUBE',
              url: `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`,
              title: null,
              position: 1,
            },
          ],
        }),
      );
      const withNothing = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          parts: [
            {
              performer: 'LEAD',
              position: 1,
              lines: [
                {
                  originalText: 'No extras',
                  position: 1,
                  phonetics: [],
                  translations: [],
                },
              ],
            },
          ],
          media: [],
        }),
      );
      await publishSong(OWNER_TOKEN, withEverything.id);
      await publishSong(OWNER_TOKEN, withNothing.id);

      async function idsFor(query: Record<string, string>): Promise<string[]> {
        const response = await listSongs(OWNER_TOKEN, {
          page: 1,
          limit: 50,
          createdByMe: 'true',
          ...query,
        });
        return response.data.map((s) => s.id);
      }

      expect(await idsFor({ hasPhonetics: 'true' })).toEqual(
        expect.arrayContaining([withEverything.id]),
      );
      expect(await idsFor({ hasPhonetics: 'true' })).not.toEqual(
        expect.arrayContaining([withNothing.id]),
      );
      expect(await idsFor({ hasPhonetics: 'false' })).toEqual(
        expect.arrayContaining([withNothing.id]),
      );
      expect(await idsFor({ hasMedia: 'true' })).toEqual(
        expect.arrayContaining([withEverything.id]),
      );
      expect(await idsFor({ hasMedia: 'false' })).toEqual(
        expect.arrayContaining([withNothing.id]),
      );
      expect(await idsFor({ hasTranslation: 'true' })).toEqual(
        expect.arrayContaining([withEverything.id]),
      );
      expect(await idsFor({ translationLanguage: 'pl' })).toEqual(
        expect.arrayContaining([withEverything.id]),
      );
      expect(await idsFor({ translationLanguage: 'en' })).not.toEqual(
        expect.arrayContaining([withEverything.id]),
      );
    });

    it('sorts by title ascending and defaults to -createdAt', async () => {
      const marker = randomUUID().slice(0, 8);
      const first = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          title: `AAA-${marker}`,
          alternativeTitles: [],
        }),
      );
      const second = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id, {
          title: `ZZZ-${marker}`,
          alternativeTitles: [],
        }),
      );
      await publishSong(OWNER_TOKEN, first.id);
      await publishSong(OWNER_TOKEN, second.id);

      const ascByTitle = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        sort: 'title',
        createdByMe: 'true',
        search: marker,
      });
      expect(ascByTitle.data.map((s) => s.id)).toEqual([first.id, second.id]);

      const defaultSort = await listSongs(OWNER_TOKEN, {
        page: 1,
        limit: 50,
        createdByMe: 'true',
        search: marker,
      });
      expect(defaultSort.data.map((s) => s.id)).toEqual([second.id, first.id]);
    });
  });

  describe('moderation', () => {
    // Submitted by its own creator (OWNER_TOKEN, EDITOR), but every
    // approve/reject/hide/restore step is done by MODERATOR_TOKEN - the
    // creator can never self-approve their own submission (see
    // SongsService.assertNotSelfApproval), so a single-actor walk of this
    // lifecycle is no longer representable end-to-end.
    it('walks DRAFT -> PENDING_REVIEW -> PUBLISHED -> HIDDEN -> PUBLISHED', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const id = song.id;

      const submitted = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/submit`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(submitted.status).toBe('PENDING_REVIEW');

      const published = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/publish`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(201),
      );
      expect(published.status).toBe('PUBLISHED');

      const hidden = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/hide`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(201),
      );
      expect(hidden.status).toBe('HIDDEN');

      const restored = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/restore`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(201),
      );
      expect(restored.status).toBe('PUBLISHED');
    });

    it('DRAFT -> PENDING_REVIEW -> REJECTED (with a reason), then resubmit clears it', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const id = song.id;

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const rejected = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/reject`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ reason: 'Missing translation for the chorus' })
          .expect(201),
      );
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe(
        'Missing translation for the chorus',
      );

      const resubmitted = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/submit`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(resubmitted.status).toBe('PENDING_REVIEW');
      expect(resubmitted.rejectionReason).toBeNull();
    });

    it('rejects an invalid transition with 409', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/publish`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('rejects self-approval: the creator cannot publish or reject their own submission, even as a MODERATOR', async () => {
      await grantContentApprove(OWNER_TOKEN);
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/publish`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('SELF_APPROVAL_FORBIDDEN');

      // Restore OWNER_TOKEN back to its normal EDITOR tier for every other
      // test in this file.
      await grantGlobalRole(OWNER_TOKEN, GlobalRole.EDITOR);
    });

    // SUPER_ADMIN is the one exception to the rule above - it already
    // holds every Permission unconditionally (role-permissions.map.ts), so
    // assertNotSelfApproval must not block it either.
    it('allows self-approval for a SUPER_ADMIN', async () => {
      await grantGlobalRole(OWNER_TOKEN, GlobalRole.SUPER_ADMIN);
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const published = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/publish`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(published.status).toBe('PUBLISHED');

      // Restore OWNER_TOKEN back to its normal EDITOR tier for every other
      // test in this file.
      await grantGlobalRole(OWNER_TOKEN, GlobalRole.EDITOR);
    });

    // Central regression test for the moderation model's goal #1: every
    // signed-in USER (no elevated globalRole needed) can add a song - see
    // role-permissions.map.ts giving USER SONG_CREATE/SONG_EDIT_OWN. It
    // must land as a private DRAFT, never auto-published.
    it('lets a plain USER create a song - 201, DRAFT, owned by them', async () => {
      const created = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );

      expect(created.status).toBe('DRAFT');

      const em = app.get(EntityManager).fork();
      const auth = TOKEN_TO_AUTH[PLAIN_USER_TOKEN];
      const plainUser = await em.findOneOrFail(User, {
        clerkUserId: auth.userId,
      });
      expect(created.createdBy?.id).toBe(plainUser.id);
    });

    it('lets a plain USER edit their own DRAFT (SONG_EDIT_OWN)', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );

      const patched = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
          .send(minimalSongPayload(category.id, { title: 'Edited by USER' }))
          .expect(200),
      );
      expect(patched.title).toBe('Edited by USER');
    });

    it("rejects a plain USER editing another user's DRAFT with 403 - no SONG_EDIT_ANY", async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .patch(`/api/v1/songs/${song.id}`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .send(minimalSongPayload(category.id))
        .expect(403);
    });

    it('lets a plain USER submit their own DRAFT for review', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );

      const submitted = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/submit`)
          .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
          .expect(201),
      );
      expect(submitted.status).toBe('PENDING_REVIEW');
    });

    it("rejects submitting another user's DRAFT without SONG_EDIT_ANY with 403", async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(403);
    });

    it("rejects deleting another user's DRAFT without SONG_DELETE with 403 SONG_NOT_OWNED", async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('SONG_NOT_OWNED');
    });

    it('rejects editing a PUBLISHED song directly (PATCH) with 409 SONG_PROTECTED - even for its own creator', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OWNER_TOKEN, song.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(minimalSongPayload(category.id))
          .expect(409),
      );
      expect(response.code).toBe('SONG_PROTECTED');
    });

    it('DELETE removes a DRAFT song (204) but refuses a PUBLISHED one (409)', async () => {
      const draft = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${draft.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
      createdSongIds.splice(createdSongIds.indexOf(draft.id), 1);

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${draft.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);

      const published = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OWNER_TOKEN, published.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/songs/${published.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('SONG_NOT_DELETABLE');
    });
  });

  describe('media verification', () => {
    it('verifies and unverifies a media source, idempotently, as a moderator', async () => {
      await grantContentApprove(MODERATOR_TOKEN);

      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const mediaId = song.media[0].id;
      expect(song.media[0].isVerified).toBe(false);
      // Submitted so it's actually part of the moderation workflow -
      // GET /moderation/songs/:id only resolves PENDING_REVIEW/REJECTED
      // (see SongsService.getModerationDetails), not a bare DRAFT.
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const verified = await bodyOf<SongMediaDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/media/${mediaId}/verify`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
      );
      expect(verified).toMatchObject({
        id: mediaId,
        songId: song.id,
        isVerified: true,
      });

      // PENDING_REVIEW at this point - fetched via the moderation detail
      // endpoint, not the public GET /songs/:id (PUBLISHED-only).
      const detailsAfterVerify = await getModerationDetails(
        MODERATOR_TOKEN,
        song.id,
      );
      expect(detailsAfterVerify.media[0].isVerified).toBe(true);

      // Re-verify is idempotent - still 200, still true.
      const reVerified = await bodyOf<SongMediaDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/media/${mediaId}/verify`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
      );
      expect(reVerified.isVerified).toBe(true);

      const unverified = await bodyOf<SongMediaDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/media/${mediaId}/unverify`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
      );
      expect(unverified.isVerified).toBe(false);

      // Re-unverify is idempotent - still 200, still false.
      const reUnverified = await bodyOf<SongMediaDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/media/${mediaId}/unverify`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
      );
      expect(reUnverified.isVerified).toBe(false);
    });

    it('rejects verify without CONTENT_APPROVE with 403', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const mediaId = song.media[0].id;

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/media/${mediaId}/verify`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(403);
    });

    it('rejects verify without a token with 401', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const mediaId = song.media[0].id;

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/media/${mediaId}/verify`)
        .expect(401);
    });

    it('rejects a malformed songId or mediaId with 400', async () => {
      await grantContentApprove(MODERATOR_TOKEN);
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const mediaId = song.media[0].id;

      await request(app.getHttpServer())
        .post(`/api/v1/songs/not-a-uuid/media/${mediaId}/verify`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/media/not-a-uuid/verify`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(400);
    });

    it('returns 404 SONG_MEDIA_NOT_FOUND for a non-existent media id', async () => {
      await grantContentApprove(MODERATOR_TOKEN);
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/media/${randomUUID()}/verify`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(404),
      );
      expect(response.code).toBe('SONG_MEDIA_NOT_FOUND');
    });

    it('returns 404 when the media belongs to a different song', async () => {
      await grantContentApprove(MODERATOR_TOKEN);
      const songA = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const songB = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const mediaFromSongB = songB.media[0].id;

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${songA.id}/media/${mediaFromSongB}/verify`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(404),
      );
      expect(response.code).toBe('SONG_MEDIA_NOT_FOUND');
    });
  });

  describe('media voting', () => {
    function twoMediaPayload(): Record<string, unknown> {
      return minimalSongPayload(category.id, {
        media: [
          {
            provider: 'YOUTUBE',
            url: `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`,
            title: 'Media A',
            position: 1,
          },
          {
            provider: 'YOUTUBE',
            url: `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`,
            title: 'Media B',
            position: 2,
          },
        ],
      });
    }

    it('walks the full vote lifecycle: first vote, move, idempotent re-vote, a second voter, and removal', async () => {
      const song = await createSong(OWNER_TOKEN, twoMediaPayload());
      const mediaA = song.media[0].id;
      const mediaB = song.media[1].id;

      // 1. OWNER votes for media A.
      const firstVote = await voteFor(OWNER_TOKEN, song.id, mediaA);
      expect(firstVote).toEqual({
        songId: song.id,
        mediaId: mediaA,
        voteCount: 1,
        isVotedByCurrentUser: true,
      });

      const afterFirstVote = await getMySubmissionDetails(OWNER_TOKEN, song.id);
      expect(afterFirstVote.media.find((m) => m.id === mediaA)).toMatchObject({
        voteCount: 1,
        isVotedByCurrentUser: true,
      });
      expect(afterFirstVote.media.find((m) => m.id === mediaB)).toMatchObject({
        voteCount: 0,
        isVotedByCurrentUser: false,
      });

      // 2. OWNER moves their vote to media B.
      const movedVote = await voteFor(OWNER_TOKEN, song.id, mediaB);
      expect(movedVote).toEqual({
        songId: song.id,
        mediaId: mediaB,
        voteCount: 1,
        isVotedByCurrentUser: true,
      });

      const em = app.get(EntityManager).fork();
      const voteCountForOwner = await em.count(SongMediaVote, {
        song: song.id,
      });
      expect(voteCountForOwner).toBe(1);

      const afterMove = await getMySubmissionDetails(OWNER_TOKEN, song.id);
      expect(afterMove.media.find((m) => m.id === mediaA)).toMatchObject({
        voteCount: 0,
        isVotedByCurrentUser: false,
      });
      expect(afterMove.media.find((m) => m.id === mediaB)).toMatchObject({
        voteCount: 1,
        isVotedByCurrentUser: true,
      });

      // 3. Re-voting for media B is idempotent.
      const reVote = await voteFor(OWNER_TOKEN, song.id, mediaB);
      expect(reVote).toEqual(movedVote);

      // 4. A second user votes for media B too.
      const secondVote = await voteFor(OTHER_TOKEN, song.id, mediaB);
      expect(secondVote).toMatchObject({ mediaId: mediaB, voteCount: 2 });

      const afterSecondVoter = await getMySubmissionDetails(
        OWNER_TOKEN,
        song.id,
      );
      expect(afterSecondVoter.media.find((m) => m.id === mediaB)).toMatchObject(
        {
          voteCount: 2,
          isVotedByCurrentUser: true,
        },
      );

      // 5. OWNER removes their vote - media B keeps the other voter's vote.
      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/vote`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const afterRemove = await getMySubmissionDetails(OWNER_TOKEN, song.id);
      expect(afterRemove.media.find((m) => m.id === mediaB)).toMatchObject({
        voteCount: 1,
        isVotedByCurrentUser: false,
      });

      // 6. Removing again is idempotent (still 204, not 404).
      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/vote`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });

    it('lets the same user hold independent votes in two different songs', async () => {
      const songA = await createSong(OWNER_TOKEN, twoMediaPayload());
      const songB = await createSong(OWNER_TOKEN, twoMediaPayload());

      await voteFor(OWNER_TOKEN, songA.id, songA.media[0].id);
      const voteInB = await voteFor(OWNER_TOKEN, songB.id, songB.media[1].id);

      expect(voteInB).toEqual({
        songId: songB.id,
        mediaId: songB.media[1].id,
        voteCount: 1,
        isVotedByCurrentUser: true,
      });

      const detailsA = await getMySubmissionDetails(OWNER_TOKEN, songA.id);
      expect(
        detailsA.media.find((m) => m.id === songA.media[0].id),
      ).toMatchObject({ isVotedByCurrentUser: true });
    });

    it('returns 404 when the media belongs to a different song', async () => {
      const songA = await createSong(OWNER_TOKEN, twoMediaPayload());
      const songB = await createSong(OWNER_TOKEN, twoMediaPayload());

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/songs/${songA.id}/media/${songB.media[0].id}/vote`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(404),
      );
      expect(response.code).toBe('SONG_MEDIA_NOT_FOUND');
    });

    it('rejects voting without a token with 401', async () => {
      const song = await createSong(OWNER_TOKEN, twoMediaPayload());

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/media/${song.media[0].id}/vote`)
        .expect(401);
    });

    it('rejects a malformed songId or mediaId with 400', async () => {
      const song = await createSong(OWNER_TOKEN, twoMediaPayload());

      await request(app.getHttpServer())
        .put(`/api/v1/songs/not-a-uuid/media/${song.media[0].id}/vote`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(400);

      await request(app.getHttpServer())
        .put(`/api/v1/songs/${song.id}/media/not-a-uuid/vote`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(400);

      await request(app.getHttpServer())
        .delete('/api/v1/songs/not-a-uuid/vote')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(400);
    });

    it('DELETE without a token returns 401', async () => {
      const song = await createSong(OWNER_TOKEN, twoMediaPayload());

      await request(app.getHttpServer())
        .delete(`/api/v1/songs/${song.id}/vote`)
        .expect(401);
    });

    it('any authenticated globalRole may vote - no CONTENT_APPROVE required', async () => {
      const song = await createSong(OWNER_TOKEN, twoMediaPayload());

      // PLAIN_USER_TOKEN's user stays at the default globalRole USER
      // (never elevated - see beforeAll), which has no permission at all
      // beyond SONG_READ - voting must still succeed regardless.
      await voteFor(PLAIN_USER_TOKEN, song.id, song.media[0].id);
    });
  });

  describe('duplicate detection', () => {
    describe('GET /songs/duplicate-suggestions', () => {
      it('returns an empty list for a title shorter than 3 characters, without erroring', async () => {
        const response = await getDuplicateSuggestions(OWNER_TOKEN, 'ab');
        expect(response).toEqual({ items: [] });
      });

      it('finds an identical title at the top of the results', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Suggestion Marker Exact ${marker}`;
        const song = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, 'Some first line'),
        );
        await publishSong(OWNER_TOKEN, song.id);

        const response = await getDuplicateSuggestions(OTHER_TOKEN, title);

        expect(response.items[0]).toMatchObject({
          id: song.id,
          title,
          firstLine: 'Some first line',
          status: 'PUBLISHED',
          similarity: 1,
        });
      });

      it('finds a title with diacritics when the query has none', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Paranauê Suggestion ${marker}`;
        const song = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, 'Paranauê, paranauê Paraná'),
        );
        await publishSong(OWNER_TOKEN, song.id);

        // Deliberately no diacritics in the search term.
        const response = await getDuplicateSuggestions(
          OTHER_TOKEN,
          `paranaue suggestion ${marker}`,
        );

        expect(response.items.map((item) => item.id)).toContain(song.id);
      });

      it('respects the limit query param', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Limit Marker ${marker}`;
        const songA = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, 'Line A'),
        );
        await publishSong(OWNER_TOKEN, songA.id);
        const songB = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, `${title} variant`, 'Line B'),
        );
        await publishSong(OWNER_TOKEN, songB.id);

        const response = await getDuplicateSuggestions(OTHER_TOKEN, title, 1);

        expect(response.items).toHaveLength(1);
      });

      it("does not return another user's DRAFT, but does return the owner's own DRAFT", async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Draft Visibility Marker ${marker}`;
        const song = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, 'Draft line'),
        );

        const asOwner = await getDuplicateSuggestions(OWNER_TOKEN, title);
        expect(asOwner.items.map((item) => item.id)).toContain(song.id);

        const asOther = await getDuplicateSuggestions(OTHER_TOKEN, title);
        expect(asOther.items.map((item) => item.id)).not.toContain(song.id);
      });

      it('returns a PENDING_REVIEW song to any authenticated user', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Pending Marker ${marker}`;
        const song = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, 'Pending line'),
        );
        await request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/submit`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201);

        const response = await getDuplicateSuggestions(OTHER_TOKEN, title);

        expect(response.items).toContainEqual(
          expect.objectContaining({ id: song.id, status: 'PENDING_REVIEW' }),
        );
      });

      it('computes firstLine as the first non-empty lyric line in part/line position order', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `First Line Marker ${marker}`;
        const song = await createSong(
          OWNER_TOKEN,
          minimalSongPayload(category.id, {
            title,
            alternativeTitles: [],
            parts: [
              {
                performer: 'LEAD',
                position: 1,
                lines: [
                  {
                    originalText: 'The actual first line',
                    position: 1,
                    phonetics: [],
                    translations: [],
                  },
                  {
                    originalText: 'The second line',
                    position: 2,
                    phonetics: [],
                    translations: [],
                  },
                ],
              },
              {
                performer: 'CHORUS',
                position: 2,
                lines: [
                  {
                    originalText: 'A later part line',
                    position: 1,
                    phonetics: [],
                    translations: [],
                  },
                ],
              },
            ],
            media: [],
          }),
        );
        await publishSong(OWNER_TOKEN, song.id);

        const response = await getDuplicateSuggestions(OTHER_TOKEN, title);

        expect(response.items[0]).toMatchObject({
          id: song.id,
          firstLine: 'The actual first line',
        });
      });

      it('does not return titles with low similarity', async () => {
        const marker = randomUUID().slice(0, 8);
        const song = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(
            category.id,
            `Zzyzx Nonmatching Title ${marker}`,
            'Irrelevant line',
          ),
        );
        await publishSong(OWNER_TOKEN, song.id);

        const response = await getDuplicateSuggestions(
          OTHER_TOKEN,
          `Completely unrelated search ${marker}`,
        );

        expect(response.items.map((item) => item.id)).not.toContain(song.id);
      });

      it('rejects an unauthenticated request with 401', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/songs/duplicate-suggestions')
          .query({ title: 'Paranauê' })
          .expect(401);
      });
    });

    describe('POST /songs/:id/submit duplicate blocking', () => {
      it('blocks submit with 409 DUPLICATE_SONG against a PUBLISHED near-duplicate', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Block Published Marker ${marker}`;
        const firstLine = 'This exact line repeats';

        const original = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );
        await publishSong(OWNER_TOKEN, original.id);

        const attempt = await createSong(
          OTHER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );

        const response = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/songs/${attempt.id}/submit`)
            .set('Authorization', `Bearer ${OTHER_TOKEN}`)
            .expect(409),
        );

        expect(response.code).toBe('DUPLICATE_SONG');
        expect(response.duplicates).toBeDefined();
        expect(response.duplicates?.length).toBeGreaterThan(0);
        expect(response.duplicates?.length).toBeLessThanOrEqual(3);
        expect(response.duplicates?.[0]).toMatchObject({
          id: original.id,
          status: 'PUBLISHED',
        });
        // No private/internal data leaked in the duplicate entries.
        const keys = Object.keys(
          (response.duplicates as Record<string, unknown>[])[0],
        );
        expect(keys.sort()).toEqual(
          ['id', 'title', 'firstLine', 'status', 'similarity'].sort(),
        );

        const afterAttempt = await getMySubmissionDetails(
          OTHER_TOKEN,
          attempt.id,
        );
        expect(afterAttempt.status).toBe('DRAFT');
      });

      it('blocks submit with 409 against a PENDING_REVIEW near-duplicate from another user', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Block Pending Marker ${marker}`;
        const firstLine = 'Shared pending line';

        const pending = await createSong(
          OTHER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );
        await request(app.getHttpServer())
          .post(`/api/v1/songs/${pending.id}/submit`)
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(201);

        const attempt = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );

        const response = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/songs/${attempt.id}/submit`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(409),
        );

        expect(response.code).toBe('DUPLICATE_SONG');
      });

      it('allows submit when the title matches exactly but the lyrics are clearly different', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Same Title Different Song ${marker}`;

        const original = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(
            category.id,
            title,
            'Uma historia completamente diferente aqui meu amigo',
          ),
        );
        await publishSong(OWNER_TOKEN, original.id);

        const variant = await createSong(
          OTHER_TOKEN,
          duplicateTestPayload(
            category.id,
            title,
            'Vou falar de outra coisa agora mesmo pessoal',
          ),
        );

        const submitted = await bodyOf<SongDetailsResponseDto>(
          request(app.getHttpServer())
            .post(`/api/v1/songs/${variant.id}/submit`)
            .set('Authorization', `Bearer ${OTHER_TOKEN}`)
            .expect(201),
        );
        expect(submitted.status).toBe('PENDING_REVIEW');
      });

      it("does not block on another user's DRAFT with the same title/line", async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Foreign Draft Marker ${marker}`;
        const firstLine = 'A line only a draft owner can see';

        await createSong(
          OTHER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );

        const own = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );

        const submitted = await bodyOf<SongDetailsResponseDto>(
          request(app.getHttpServer())
            .post(`/api/v1/songs/${own.id}/submit`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(201),
        );
        expect(submitted.status).toBe('PENDING_REVIEW');
      });

      it("blocks on the same user's own other DRAFT with the same title/line", async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Own Draft Marker ${marker}`;
        const firstLine = 'A line the same owner wrote twice';

        await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );
        const second = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );

        const response = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/songs/${second.id}/submit`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(409),
        );
        expect(response.code).toBe('DUPLICATE_SONG');
      });

      it('never compares a song against itself (resubmit after reject succeeds)', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Resubmit Marker ${marker}`;
        const song = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, 'Resubmit line'),
        );

        await request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/submit`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201);
        // Rejected by a moderator, never the song's own creator (self-
        // approval is forbidden - see SongsService.assertNotSelfApproval).
        await request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/reject`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ reason: null })
          .expect(201);

        const resubmitted = await bodyOf<SongDetailsResponseDto>(
          request(app.getHttpServer())
            .post(`/api/v1/songs/${song.id}/submit`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(201),
        );
        expect(resubmitted.status).toBe('PENDING_REVIEW');
      });

      it('caps the duplicates payload at 3 entries even with more matches', async () => {
        const marker = randomUUID().slice(0, 8);
        const title = `Many Matches Marker ${marker}`;
        const firstLine = 'A very shared line indeed';

        for (let i = 0; i < 4; i += 1) {
          await createSong(
            OWNER_TOKEN,
            duplicateTestPayload(category.id, title, firstLine),
          );
        }
        const attempt = await createSong(
          OWNER_TOKEN,
          duplicateTestPayload(category.id, title, firstLine),
        );

        const response = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/songs/${attempt.id}/submit`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(409),
        );

        expect(response.duplicates?.length).toBeLessThanOrEqual(3);
      });
    });
  });

  describe('GET /songs/my-submissions', () => {
    it("returns only the caller's own DRAFT/PENDING_REVIEW/REJECTED songs, never another user's", async () => {
      const a1 = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      const a2 = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${a2.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);
      const a3 = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${a3.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${a3.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Needs work' })
        .expect(201);

      const b1 = await createSong(OTHER_TOKEN, minimalSongPayload(category.id));
      const b2 = await createSong(OTHER_TOKEN, minimalSongPayload(category.id));
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${b2.id}/submit`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(201);

      const response = await listMySubmissions(PLAIN_USER_TOKEN, {
        page: 1,
        limit: 50,
      });
      const ids = response.data.map((s) => s.id);

      expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id, a3.id]));
      expect(ids).not.toContain(b1.id);
      expect(ids).not.toContain(b2.id);
    });

    it('filters by status', async () => {
      const draft = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      const pending = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${pending.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);

      const response = await listMySubmissions(PLAIN_USER_TOKEN, {
        page: 1,
        limit: 50,
        status: 'PENDING_REVIEW',
      });
      const ids = response.data.map((s) => s.id);

      expect(ids).toContain(pending.id);
      expect(ids).not.toContain(draft.id);
    });

    it('never includes a PUBLISHED song - that belongs in GET /songs', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(PLAIN_USER_TOKEN, song.id);

      const response = await listMySubmissions(PLAIN_USER_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(response.data.map((s) => s.id)).not.toContain(song.id);
    });

    it("GET /songs/my-submissions/:id 404s for another user's submission", async () => {
      const song = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .get(`/api/v1/songs/my-submissions/${song.id}`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(404);
    });

    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/songs/my-submissions')
        .expect(401);
    });
  });

  describe('GET /moderation/songs (moderation queue)', () => {
    it('defaults to PENDING_REVIEW across every submitter, excluding DRAFT', async () => {
      const songA = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${songA.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);

      const songB = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${songB.id}/submit`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(201);

      const songC = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );

      const response = await listModerationQueue(MODERATOR_TOKEN, {
        page: 1,
        limit: 50,
      });
      const ids = response.data.map((s) => s.id);

      expect(ids).toEqual(expect.arrayContaining([songA.id, songB.id]));
      expect(ids).not.toContain(songC.id);
    });

    it('?status=REJECTED surfaces recently-decided submissions instead', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Not ready' })
        .expect(201);

      const defaultQueue = await listModerationQueue(MODERATOR_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(defaultQueue.data.map((s) => s.id)).not.toContain(song.id);

      const rejectedQueue = await listModerationQueue(MODERATOR_TOKEN, {
        page: 1,
        limit: 50,
        status: 'REJECTED',
      });
      expect(rejectedQueue.data.map((s) => s.id)).toContain(song.id);
    });

    it('rejects a plain USER with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/moderation/songs')
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(403);
    });

    it('GET /moderation/songs/:id lets a MODERATOR open a submission by id', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);

      const details = await getModerationDetails(MODERATOR_TOKEN, song.id);
      expect(details.status).toBe('PENDING_REVIEW');
    });

    it('GET /moderation/songs/:id rejects a plain USER with 403', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .get(`/api/v1/moderation/songs/${song.id}`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(403);
    });

    // GET /moderation/songs/:id is narrower than "any Song a MODERATOR can
    // read" - it only ever resolves a Song actually in the new-song
    // moderation workflow (PENDING_REVIEW/REJECTED, the same set
    // GET /moderation/songs itself defaults/filters to). Anything else
    // 404s even for a MODERATOR, exactly like a Song that doesn't exist -
    // see SongsService.getModerationDetails's own comment.
    it('GET /moderation/songs/:id returns 200 for REJECTED too', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: 'Not ready' })
        .expect(201);

      const details = await getModerationDetails(MODERATOR_TOKEN, song.id);
      expect(details.status).toBe('REJECTED');
    });

    it('GET /moderation/songs/:id returns 404 for DRAFT, even for a MODERATOR', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .get(`/api/v1/moderation/songs/${song.id}`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(404);
    });

    it('GET /moderation/songs/:id returns 404 for PUBLISHED, even though GET /songs/:id returns it', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(PLAIN_USER_TOKEN, song.id);

      await request(app.getHttpServer())
        .get(`/api/v1/moderation/songs/${song.id}`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(404);

      // The public songbook is unaffected - still 200 there.
      const publicDetails = await getSongDetails(PLAIN_USER_TOKEN, song.id);
      expect(publicDetails.status).toBe('PUBLISHED');
    });

    it('GET /moderation/songs/:id returns 404 for HIDDEN, even for a MODERATOR', async () => {
      const song = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(PLAIN_USER_TOKEN, song.id);
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/hide`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/moderation/songs/${song.id}`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(404);
    });
  });

  describe('full moderation workflow', () => {
    it('create -> submit -> moderation queue -> publish -> visible in the songbook', async () => {
      const created = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      expect(created.status).toBe('DRAFT');

      await request(app.getHttpServer())
        .patch(`/api/v1/songs/${created.id}`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .send(minimalSongPayload(category.id, { title: 'Ready for review' }))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${created.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);

      // Not yet part of the songbook.
      const beforePublish = await listSongs(PLAIN_USER_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(beforePublish.data.map((s) => s.id)).not.toContain(created.id);

      // The moderator sees it in the queue and can open its details.
      const queue = await listModerationQueue(MODERATOR_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(queue.data.map((s) => s.id)).toContain(created.id);

      const moderationDetails = await getModerationDetails(
        MODERATOR_TOKEN,
        created.id,
      );
      expect(moderationDetails.title).toBe('Ready for review');

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${created.id}/publish`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(201);

      // Now it's part of the public songbook.
      const afterPublish = await listSongs(PLAIN_USER_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(afterPublish.data.map((s) => s.id)).toContain(created.id);

      const publicDetails = await getSongDetails(PLAIN_USER_TOKEN, created.id);
      expect(publicDetails.status).toBe('PUBLISHED');
    });

    it('create -> submit -> reject -> not in songbook -> visible to author and moderator -> resubmit reopens the queue', async () => {
      const created = await createSong(
        PLAIN_USER_TOKEN,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${created.id}/submit`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(201);

      const rejected = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${created.id}/reject`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ reason: 'Please add a translation' })
          .expect(201),
      );
      expect(rejected.status).toBe('REJECTED');

      const songbook = await listSongs(PLAIN_USER_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(songbook.data.map((s) => s.id)).not.toContain(created.id);

      const mySubmissions = await listMySubmissions(PLAIN_USER_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(mySubmissions.data.map((s) => s.id)).toContain(created.id);

      const defaultQueue = await listModerationQueue(MODERATOR_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(defaultQueue.data.map((s) => s.id)).not.toContain(created.id);

      const rejectedQueue = await listModerationQueue(MODERATOR_TOKEN, {
        page: 1,
        limit: 50,
        status: 'REJECTED',
      });
      expect(rejectedQueue.data.map((s) => s.id)).toContain(created.id);

      await request(app.getHttpServer())
        .patch(`/api/v1/songs/${created.id}`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .send(
          minimalSongPayload(category.id, { title: 'Fixed after rejection' }),
        )
        .expect(200);

      const resubmitted = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${created.id}/submit`)
          .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
          .expect(201),
      );
      expect(resubmitted.status).toBe('PENDING_REVIEW');
      expect(resubmitted.rejectionReason).toBeNull();

      const pendingQueue = await listModerationQueue(MODERATOR_TOKEN, {
        page: 1,
        limit: 50,
      });
      expect(pendingQueue.data.map((s) => s.id)).toContain(created.id);
    });
  });
});
