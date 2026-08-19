/**
 * E2E tests for the Song edit-proposal moderation workflow - see the
 * moderation model report and song-edit-proposals.controller.ts. A
 * PUBLISHED/HIDDEN Song is never edited directly again; every further
 * change is a SongEditProposal a moderator must approve, and the current
 * PUBLISHED version stays fully intact until then.
 */
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
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { SongEditProposalResponseDto } from '../src/songs/dto/song-edit-proposal-response.dto';
import { Song } from '../src/songs/entities/song.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';
import { SongEditProposal } from '../src/songs/entities/song-edit-proposal.entity';

const OWNER_TOKEN = 'valid-sep-owner-token';
const PROPOSER_TOKEN = 'valid-sep-proposer-token';
const MODERATOR_TOKEN = 'valid-sep-moderator-token';
const OTHER_MODERATOR_TOKEN = 'valid-sep-other-moderator-token';
// Never elevated beyond the default globalRole USER - see its own test.
const PLAIN_USER_TOKEN = 'valid-sep-plain-user-token';

const OWNER_CLERK_ID = 'user_test_sep_owner';
const PROPOSER_CLERK_ID = 'user_test_sep_proposer';
const MODERATOR_CLERK_ID = 'user_test_sep_moderator';
const OTHER_MODERATOR_CLERK_ID = 'user_test_sep_other_moderator';
const PLAIN_USER_CLERK_ID = 'user_test_sep_plain_user';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_sep_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_sep_owner' },
  },
  [PROPOSER_TOKEN]: {
    userId: PROPOSER_CLERK_ID,
    sessionId: 'sess_sep_proposer',
    tokenType: 'session_token',
    claims: { sub: PROPOSER_CLERK_ID, sid: 'sess_sep_proposer' },
  },
  [MODERATOR_TOKEN]: {
    userId: MODERATOR_CLERK_ID,
    sessionId: 'sess_sep_moderator',
    tokenType: 'session_token',
    claims: { sub: MODERATOR_CLERK_ID, sid: 'sess_sep_moderator' },
  },
  [OTHER_MODERATOR_TOKEN]: {
    userId: OTHER_MODERATOR_CLERK_ID,
    sessionId: 'sess_sep_other_moderator',
    tokenType: 'session_token',
    claims: { sub: OTHER_MODERATOR_CLERK_ID, sid: 'sess_sep_other_moderator' },
  },
  [PLAIN_USER_TOKEN]: {
    userId: PLAIN_USER_CLERK_ID,
    sessionId: 'sess_sep_plain_user',
    tokenType: 'session_token',
    claims: { sub: PLAIN_USER_CLERK_ID, sid: 'sess_sep_plain_user' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/sep-owner.png',
    primaryEmailAddress: { emailAddress: 'sep.owner@example.com' },
  },
  [PROPOSER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/sep-proposer.png',
    primaryEmailAddress: { emailAddress: 'sep.proposer@example.com' },
  },
  [MODERATOR_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/sep-moderator.png',
    primaryEmailAddress: { emailAddress: 'sep.moderator@example.com' },
  },
  [OTHER_MODERATOR_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/sep-other-moderator.png',
    primaryEmailAddress: { emailAddress: 'sep.other.moderator@example.com' },
  },
  [PLAIN_USER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/sep-plain-user.png',
    primaryEmailAddress: { emailAddress: 'sep.plain.user@example.com' },
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
    alternativeTitles: [],
    tagIds: [],
    parts: [
      {
        performer: 'LEAD',
        position: 1,
        lines: [
          {
            originalText: 'Paranauê, paranauê Paraná',
            phoneticText: null,
            position: 1,
            translations: [{ languageCode: 'pl', text: 'Wersja polska' }],
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

describe('Song Edit Proposals (e2e)', () => {
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
    category.code = `TEST_SEP_${randomUUID().slice(0, 8)}`;
    category.name = 'Test category';
    category.position = 999;
    category.isActive = true;
    await em.persistAndFlush(category);

    await grantGlobalRole(OWNER_TOKEN, GlobalRole.EDITOR);
    await grantGlobalRole(PROPOSER_TOKEN, GlobalRole.EDITOR);
    await grantGlobalRole(MODERATOR_TOKEN, GlobalRole.MODERATOR);
    await grantGlobalRole(OTHER_MODERATOR_TOKEN, GlobalRole.MODERATOR);
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(SongEditProposal, {
        song: { $in: createdSongIds },
      });
      await cleanup.nativeDelete(Song, { category: category.id });
      await cleanup.nativeDelete(SongCategory, { id: category.id });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
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

  async function publishOwnSong(ownerToken: string, id: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/submit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/publish`)
      .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
      .expect(201);
  }

  async function createPublishedSong(
    ownerToken: string = OWNER_TOKEN,
    overrides: Record<string, unknown> = {},
  ): Promise<SongDetailsResponseDto> {
    const created = await createSong(
      ownerToken,
      minimalSongPayload(category.id, overrides),
    );
    await publishOwnSong(ownerToken, created.id);
    return created;
  }

  async function getSong(
    token: string,
    id: string,
  ): Promise<SongDetailsResponseDto> {
    return bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/songs/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function createProposal(
    token: string,
    songId: string,
    payload: Record<string, unknown>,
  ): Promise<SongEditProposalResponseDto> {
    return bodyOf<SongEditProposalResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/songs/${songId}/edit-proposals`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201),
    );
  }

  describe('create', () => {
    it('creates a PENDING proposal for a PUBLISHED song, without touching the Song', async () => {
      const song = await createPublishedSong();
      const before = await getSong(OWNER_TOKEN, song.id);

      const proposal = await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id, { title: 'A brand new title' }),
      );

      expect(proposal.status).toBe('PENDING');
      expect(proposal.songId).toBe(song.id);
      expect(proposal.proposedBy?.displayName).toBeDefined();
      expect(proposal.payload).toMatchObject({ title: 'A brand new title' });

      const after = await getSong(OWNER_TOKEN, song.id);
      expect(after).toEqual(before);
    });

    it("does not restrict proposing to the song's own creator - createdBy grants nothing after publication", async () => {
      const song = await createPublishedSong(OWNER_TOKEN);

      // PROPOSER_TOKEN never created this song, yet may still propose.
      await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id, { title: 'Proposed by a stranger' }),
      );
    });

    it('lets a plain, unelevated USER propose an edit for any PUBLISHED/HIDDEN song - no permission required', async () => {
      const song = await createPublishedSong();
      await grantGlobalRole(PLAIN_USER_TOKEN, GlobalRole.USER);

      const proposal = await createProposal(
        PLAIN_USER_TOKEN,
        song.id,
        minimalSongPayload(category.id, { title: 'Proposed by a plain user' }),
      );

      expect(proposal.status).toBe('PENDING');
      expect(proposal.proposedBy?.displayName).toBeDefined();
    });

    it('rejects proposing an edit for a DRAFT song with 409 EDIT_PROPOSAL_TARGET_NOT_PROTECTED', async () => {
      const draft = await createSong(
        OWNER_TOKEN,
        minimalSongPayload(category.id),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${draft.id}/edit-proposals`)
          .set('Authorization', `Bearer ${PROPOSER_TOKEN}`)
          .send(minimalSongPayload(category.id))
          .expect(409),
      );
      expect(response.code).toBe('EDIT_PROPOSAL_TARGET_NOT_PROTECTED');
    });

    it('rejects proposing an edit for a PENDING_REVIEW song with 409 EDIT_PROPOSAL_TARGET_NOT_PROTECTED', async () => {
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
          .post(`/api/v1/songs/${song.id}/edit-proposals`)
          .set('Authorization', `Bearer ${PROPOSER_TOKEN}`)
          .send(minimalSongPayload(category.id))
          .expect(409),
      );
      expect(response.code).toBe('EDIT_PROPOSAL_TARGET_NOT_PROTECTED');
    });

    it('rejects an unauthenticated request with 401', async () => {
      const song = await createPublishedSong();

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/edit-proposals`)
        .send(minimalSongPayload(category.id))
        .expect(401);
    });

    it('rejects a malformed payload the same way full create/update would, before ever persisting it', async () => {
      const song = await createPublishedSong();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/edit-proposals`)
          .set('Authorization', `Bearer ${PROPOSER_TOKEN}`)
          .send({ title: '' })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('list/getById', () => {
    it('requires CONTENT_APPROVE to list proposals for a song', async () => {
      const song = await createPublishedSong();
      await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .get(`/api/v1/songs/${song.id}/edit-proposals`)
        .set('Authorization', `Bearer ${PROPOSER_TOKEN}`)
        .expect(403);

      const list = await bodyOf<SongEditProposalResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}/edit-proposals`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
      );
      expect(list.length).toBeGreaterThanOrEqual(1);
    });

    it('gets a single proposal by id, requiring CONTENT_APPROVE', async () => {
      const song = await createPublishedSong();
      const created = await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );

      const fetched = await bodyOf<SongEditProposalResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}/edit-proposals/${created.id}`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
      );
      expect(fetched.id).toBe(created.id);
    });
  });

  describe('approve', () => {
    it('atomically applies the snapshot to the Song, keeps its status, and preserves multi-language translations', async () => {
      const song = await createPublishedSong();
      const proposalPayload = minimalSongPayload(category.id, {
        title: 'Approved new title',
        parts: [
          {
            performer: 'LEAD',
            position: 1,
            lines: [
              {
                originalText: 'Nova linha',
                phoneticText: 'no-va li-nya',
                position: 1,
                translations: [
                  { languageCode: 'pl', text: 'Nowa linia' },
                  { languageCode: 'en', text: 'New line' },
                  { languageCode: 'es', text: 'Nueva línea' },
                ],
              },
            ],
          },
        ],
      });
      const proposal = await createProposal(
        PROPOSER_TOKEN,
        song.id,
        proposalPayload,
      );

      const approved = await bodyOf<SongEditProposalResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/approve`,
          )
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(201),
      );
      expect(approved.status).toBe('APPROVED');
      expect(approved.reviewedBy?.displayName).toBeDefined();

      const after = await getSong(OWNER_TOKEN, song.id);
      expect(after.status).toBe('PUBLISHED');
      expect(after.title).toBe('Approved new title');
      const translations = after.parts[0].lines[0].translations;
      expect(translations).toHaveLength(3);
      expect(translations.map((t) => t.languageCode).sort()).toEqual([
        'en',
        'es',
        'pl',
      ]);
    });

    it('requires CONTENT_APPROVE with 403 otherwise', async () => {
      const song = await createPublishedSong();
      const proposal = await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/approve`)
        .set('Authorization', `Bearer ${PROPOSER_TOKEN}`)
        .expect(403);
    });

    it('lets a plain USER create a proposal, but still blocks them from approving it (no CONTENT_APPROVE)', async () => {
      const song = await createPublishedSong();
      await grantGlobalRole(PLAIN_USER_TOKEN, GlobalRole.USER);
      const proposal = await createProposal(
        PLAIN_USER_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/approve`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .expect(403);
    });

    it('rejects self-review: the proposer cannot approve their own proposal, even as a MODERATOR', async () => {
      const song = await createPublishedSong();
      const proposal = await createProposal(
        MODERATOR_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/approve`,
          )
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('SELF_APPROVAL_FORBIDDEN');
    });

    it('rejects approving an already-approved proposal again with 409', async () => {
      const song = await createPublishedSong();
      const proposal = await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/approve`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/approve`,
          )
          .set('Authorization', `Bearer ${OTHER_MODERATOR_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('EDIT_PROPOSAL_NOT_PENDING');
    });
  });

  describe('reject', () => {
    it('marks the proposal REJECTED with the given reason and never touches the Song', async () => {
      const song = await createPublishedSong();
      const before = await getSong(OWNER_TOKEN, song.id);
      const proposal = await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id, { title: 'Should never apply' }),
      );

      const rejected = await bodyOf<SongEditProposalResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/reject`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ reason: 'Source is not credible' })
          .expect(201),
      );
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Source is not credible');

      const after = await getSong(OWNER_TOKEN, song.id);
      expect(after).toEqual(before);
    });

    it('rejects self-review with 403, mirroring approve', async () => {
      const song = await createPublishedSong();
      const proposal = await createProposal(
        MODERATOR_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/reject`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ reason: null })
          .expect(403),
      );
      expect(response.code).toBe('SELF_APPROVAL_FORBIDDEN');
    });

    it('lets a plain USER create a proposal, but still blocks them from rejecting it (no CONTENT_APPROVE)', async () => {
      const song = await createPublishedSong();
      await grantGlobalRole(PLAIN_USER_TOKEN, GlobalRole.USER);
      const proposal = await createProposal(
        PLAIN_USER_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/reject`)
        .set('Authorization', `Bearer ${PLAIN_USER_TOKEN}`)
        .send({ reason: null })
        .expect(403);
    });

    it('rejects reviewing an already-rejected proposal again with 409', async () => {
      const song = await createPublishedSong();
      const proposal = await createProposal(
        PROPOSER_TOKEN,
        song.id,
        minimalSongPayload(category.id),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/reject`)
        .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
        .send({ reason: null })
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/songs/${song.id}/edit-proposals/${proposal.id}/reject`)
          .set('Authorization', `Bearer ${OTHER_MODERATOR_TOKEN}`)
          .send({ reason: null })
          .expect(409),
      );
      expect(response.code).toBe('EDIT_PROPOSAL_NOT_PENDING');
    });
  });
});
