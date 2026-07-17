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
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
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
const OWNER_CLERK_ID = 'user_test_songs_owner';
const OTHER_CLERK_ID = 'user_test_songs_other';
const MODERATOR_CLERK_ID = 'user_test_songs_moderator';

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
            phoneticText: 'Paranau-e',
            position: 1,
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
            phoneticText: null,
            position: 1,
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
  });

  afterAll(async () => {
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
    await app.close();
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

  async function publishSong(token: string, id: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/publish`)
      .set('Authorization', `Bearer ${token}`)
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

  // Grants CONTENT_APPROVE by setting globalRole directly through the
  // EntityManager fixture, never through a public endpoint (there is none -
  // globalRole is never settable via the API, see UserService). The first
  // authenticated request is what creates the local User row via
  // findOrCreateFromClerk, so it must happen before we can look the row up.
  async function grantContentApprove(token: string): Promise<void> {
    await request(app.getHttpServer())
      .get('/api/v1/songs')
      .query({ page: 1, limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const em = app.get(EntityManager).fork();
    const auth = TOKEN_TO_AUTH[token];
    const user = await em.findOneOrFail(User, { clerkUserId: auth.userId });
    user.globalRole = GlobalRole.MODERATOR;
    await em.flush();
  }

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

      const songId = created.id;

      const fetched = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${songId}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
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
                phoneticText: null,
                position: 1,
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

  describe('list', () => {
    it('paginates results using the standard PaginatedResponse shape', async () => {
      await createSong(OWNER_TOKEN, minimalSongPayload(category.id));
      await createSong(OWNER_TOKEN, minimalSongPayload(category.id));

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

    it("hides another user's DRAFT songs by default, but shows PUBLISHED ones", async () => {
      const ownDraft = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );
      const otherDraft = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );
      const otherPublished = await createSong(
        OTHER_TOKEN,
        minimalSongPayload(category.id),
      );
      await publishSong(OTHER_TOKEN, otherPublished.id);

      const response = await listSongs(OWNER_TOKEN, { page: 1, limit: 50 });

      const ids = response.data.map((s) => s.id);
      expect(ids).toContain(ownDraft.id);
      expect(ids).toContain(otherPublished.id);
      expect(ids).not.toContain(otherDraft.id);
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
                  phoneticText: null,
                  position: 1,
                  translations: [],
                },
              ],
            },
          ],
        }),
      );

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
                  phoneticText: 'fonetyka',
                  position: 1,
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
                  phoneticText: null,
                  position: 1,
                  translations: [],
                },
              ],
            },
          ],
          media: [],
        }),
      );

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
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(published.status).toBe('PUBLISHED');

      const hidden = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/hide`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(hidden.status).toBe('HIDDEN');

      const restored = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/restore`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(restored.status).toBe('PUBLISHED');
    });

    it('DRAFT -> PENDING_REVIEW -> REJECTED, then resubmit', async () => {
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
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(rejected.status).toBe('REJECTED');

      const resubmitted = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${id}/submit`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(resubmitted.status).toBe('PENDING_REVIEW');
    });

    it('rejects an invalid transition with 409', async () => {
      const song = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/publish`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('INVALID_STATUS_TRANSITION');
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

      const detailsAfterVerify = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
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

      const afterFirstVote = await getSongDetails(OWNER_TOKEN, song.id);
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

      const afterMove = await getSongDetails(OWNER_TOKEN, song.id);
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

      const afterSecondVoter = await getSongDetails(OWNER_TOKEN, song.id);
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

      const afterRemove = await getSongDetails(OWNER_TOKEN, song.id);
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

      const detailsA = await getSongDetails(OWNER_TOKEN, songA.id);
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

      // OTHER_TOKEN's user defaults to globalRole USER, which has no
      // CONTENT_APPROVE - voting must still succeed.
      await voteFor(OTHER_TOKEN, song.id, song.media[0].id);
    });
  });
});
