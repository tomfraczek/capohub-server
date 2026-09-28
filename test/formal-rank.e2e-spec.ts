/**
 * E2E tests for the user's formal rank (FormalRankAssignment - always a
 * catalog Rank) and CustomUserRank (a cosmetic, non-historical,
 * *singleton* "independent"/"custom" cordão - at most one row per user,
 * see custom-user-rank.entity.ts).
 *
 * Scenarios:
 *  1. A formal rank can only be set with an active formal group, from
 *     that exact group's catalog - a rank from a different group is
 *     rejected; one active assignment at a time, atomic swap preserves
 *     history
 *  2. An independent cordão can be set (PUT, upsert) freely by its owner
 *     regardless of formal-group status - there is no "activate" concept
 *     any more, and a second PUT updates the existing row in place rather
 *     than creating a second one
 *  3. Selecting a formal rank no longer touches the independent cordão at
 *     all - the two are fully decoupled now that `isActive` is gone
 *  4. awardedByName/startedOn/endedOn belong only to the formal rank - an
 *     independent cordão never has them
 *  5. An archived catalog Rank cannot be newly selected, but stays valid
 *     as the current/historical formal rank if it was already selected
 *  6. Every /users/me/custom-rank route is scoped to the caller alone
 *     (there is no `:id` any more, so IDOR is structurally moot) - GET/
 *     DELETE 404 (CUSTOM_RANK_NOT_SET) when the caller hasn't set one
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
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { closeE2eApp } from './close-e2e-app.helper';
import { createFreshGroupOwner } from './fresh-group-owner.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import { RankResponseDto } from '../src/graduation/dto/rank-response.dto';
import { CustomUserRankResponseDto } from '../src/graduation/dto/custom-user-rank-response.dto';
import { FormalRankAssignmentResponseDto } from '../src/graduation/dto/formal-rank-assignment-response.dto';
import { GraduationSystem } from '../src/graduation/entities/graduation-system.entity';
import { Rank } from '../src/graduation/entities/rank.entity';
import { CustomUserRank } from '../src/graduation/entities/custom-user-rank.entity';
import { FormalRankAssignment } from '../src/graduation/entities/formal-rank-assignment.entity';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';

// No fixed "OWNER_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user, and this file needs an
// independent Group (+ graduation catalog) owner per call, so
// createGroupWithCatalog() mints one via createFreshGroupOwner instead.
const MEMBER_TOKEN = 'valid-frank-member-token';
const OTHER_MEMBER_TOKEN = 'valid-frank-other-member-token';
const OUTSIDER_TOKEN = 'valid-frank-outsider-token';

const TOKENS = [MEMBER_TOKEN, OTHER_MEMBER_TOKEN, OUTSIDER_TOKEN];

function clerkIdFor(token: string): string {
  return `user_test_${token.replace(/-/g, '_')}`;
}

const TOKEN_TO_AUTH: Record<string, AuthContext> = Object.fromEntries(
  TOKENS.map((token) => {
    const clerkId = clerkIdFor(token);
    return [
      token,
      {
        userId: clerkId,
        sessionId: `sess_${clerkId}`,
        tokenType: 'session_token',
        claims: { sub: clerkId, sid: `sess_${clerkId}` },
      },
    ];
  }),
);

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = Object.fromEntries(
  TOKENS.map((token) => {
    const clerkId = clerkIdFor(token);
    return [
      clerkId,
      {
        imageUrl: `https://img.clerk.com/${clerkId}.png`,
        primaryEmailAddress: { emailAddress: `${clerkId}@example.com` },
      },
    ];
  }),
);

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

function oneSegment(colorHex = '#123456') {
  return [{ position: 1, colorHex, proportion: 100 }];
}

describe('Formal Rank & Custom Cordão (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const localUserIdByToken = new Map<string, string>();

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

    for (const token of TOKENS) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, {
        clerkUserId: TOKEN_TO_AUTH[token].userId,
      });
      localUserIdByToken.set(token, user.id);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(FormalRankAssignment, {
        user: { $in: [...localUserIdByToken.values()] },
      });
      // custom_user_rank_cord_segments cascades from custom_user_ranks
      // (deleteRule: 'cascade').
      await cleanup.nativeDelete(CustomUserRank, {
        user: { $in: [...localUserIdByToken.values()] },
      });

      const systems = await cleanup.find(GraduationSystem, {
        group: { $in: createdGroupIds },
      });
      const systemIds = systems.map((s) => s.id);
      // Single-statement delete, safe despite the self-referencing
      // previousRank FK - Postgres checks FK/unique constraints at the
      // end of the statement, not per-row.
      await cleanup.nativeDelete(Rank, { system: { $in: systemIds } });
      await cleanup.nativeDelete(GraduationSystem, {
        group: { $in: createdGroupIds },
      });

      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Section, {
        parentGroup: { $in: createdGroupIds },
      });
      await cleanup.nativeUpdate(
        Group,
        { id: { $in: createdGroupIds } },
        { parentGroup: null },
      );
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // Must be read fresh here (not a stale snapshot taken at module load)
      // since createGroupWithCatalog (via createFreshGroupOwner) registers a
      // fresh fixture user per call, mutating FIXTURE_CLERK_PROFILES in
      // place.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Formal Rank Test Group',
      description: null,
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      isPublic: true,
      isHidden: false,
      memberInvitesAllowed: false,
      ...overrides,
    };
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Formal Rank Test Section',
      description: null,
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      isPublic: true,
      isHidden: false,
      memberInvitesAllowed: false,
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
      country: 'PL',
      city: 'Poznań',
      region: 'Greater Poland',
      geonameId: 3088171,
      ...overrides,
    };
  }

  async function createSection(
    token: string,
    parentId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function joinSection(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken) })
      .expect(201);
  }

  async function leaveSection(
    sectionId: string,
    memberToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/leave`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(204);
  }

  async function setFormalGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId })
      .expect(200);
  }

  async function endFormalGroup(token: string): Promise<void> {
    await request(app.getHttpServer())
      .delete('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  }

  // Best-effort reset used before tests that require "no active formal
  // group" for a token that may have been left with one by an earlier
  // test in this file (tokens are shared/reused across tests) - 404
  // (already none) is a success case here too.
  async function ensureNoFormalGroup(token: string): Promise<void> {
    await request(app.getHttpServer())
      .delete('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`);
  }

  async function createGroupWithCatalog(): Promise<{
    token: string;
    userId: string;
    group: GroupResponseDto;
    section: SectionResponseDto;
    rank: RankResponseDto;
  }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'frank',
      groupOverrides: groupPayload({
        name: `Catalog Group ${Date.now()}-${Math.random()}`,
      }),
    });
    const { token } = owner;
    const group = owner.group;
    const section = await createSection(token, group.id);
    await bodyOf<GraduationSystemResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/graduation-system`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'System' })
        .expect(201),
    );
    const rank = await bodyOf<RankResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          track: RankTrack.ADULT,
          name: 'Corda Crua',
          description: null,
          previousRankId: null,
          cordSegments: oneSegment(),
        })
        .expect(201),
    );
    return { token, userId: owner.userId, group, section, rank };
  }

  async function getCurrentFormalRank(
    token: string,
  ): Promise<FormalRankAssignmentResponseDto | null> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me/formal-rank')
      .set('Authorization', `Bearer ${token}`);
    if (res.status === 404) {
      return null;
    }
    expect(res.status).toBe(200);
    return res.body as FormalRankAssignmentResponseDto;
  }

  async function setFormalRank(
    token: string,
    rankId: string,
    expectStatus = 200,
    extra: Record<string, unknown> = {},
  ): Promise<FormalRankAssignmentResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .put('/api/v1/users/me/formal-rank')
        .set('Authorization', `Bearer ${token}`)
        .send({ rankId, ...extra })
        .expect(expectStatus),
    );
  }

  async function setCustomRank(
    token: string,
    overrides: Record<string, unknown> = {},
    expectStatus = 200,
  ): Promise<CustomUserRankResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .put('/api/v1/users/me/custom-rank')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'My cordão',
          description: null,
          track: RankTrack.ADULT,
          cordSegments: oneSegment(),
          ...overrides,
        })
        .expect(expectStatus),
    );
  }

  async function getCustomRank(
    token: string,
  ): Promise<CustomUserRankResponseDto | null> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me/custom-rank')
      .set('Authorization', `Bearer ${token}`);
    if (res.status === 404) {
      return null;
    }
    expect(res.status).toBe(200);
    return res.body as CustomUserRankResponseDto;
  }

  // Best-effort reset used before tests that require "no independent rank
  // set" for a token that may have been left with one by an earlier test
  // in this file (tokens are shared/reused across tests) - 404 (already
  // none) is a success case here too.
  async function ensureNoCustomRank(token: string): Promise<void> {
    await request(app.getHttpServer())
      .delete('/api/v1/users/me/custom-rank')
      .set('Authorization', `Bearer ${token}`);
  }

  // ─── Formal rank selection ─────────────────────────────────────────────

  describe('Formal rank selection', () => {
    it('rejects setting a formal rank without an active formal group', async () => {
      const { rank } = await createGroupWithCatalog();
      const error = (await setFormalRank(
        OTHER_MEMBER_TOKEN,
        rank.id,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('rejects a rank from a group the caller is not formally affiliated with', async () => {
      const { section, group, token } = await createGroupWithCatalog();
      const otherCatalog = await createGroupWithCatalog();

      await joinSection(token, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const error = (await setFormalRank(
        MEMBER_TOKEN,
        otherCatalog.rank.id,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('sets a formal rank, persisting awardedByName and startedOn into history', async () => {
      const { section, group, rank, token } = await createGroupWithCatalog();
      await joinSection(token, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const result = (await setFormalRank(MEMBER_TOKEN, rank.id, 200, {
        awardedByName: 'Mestre Marcão',
        startedOn: '2020-01-15',
      })) as FormalRankAssignmentResponseDto;

      expect(result.awardedByName).toBe('Mestre Marcão');
      expect(result.startedOn).toBe('2020-01-15');
      expect(result.isCurrent).toBe(true);
      expect(result.sourceGroup.id).toBe(group.id);

      const current = await getCurrentFormalRank(MEMBER_TOKEN);
      expect(current?.id).toBe(result.id);
    });

    it('rejects an archived rank being newly selected, but a previously-current archived rank stays valid', async () => {
      const { section, group, rank, token } = await createGroupWithCatalog();
      await joinSection(token, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);
      await setFormalRank(MEMBER_TOKEN, rank.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks/${rank.id}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const current = await getCurrentFormalRank(MEMBER_TOKEN);
      expect(current?.rank.id).toBe(rank.id);
      expect(current?.rank.isArchived).toBe(true);

      await joinSection(token, section.id, OTHER_MEMBER_TOKEN);
      await setFormalGroup(OTHER_MEMBER_TOKEN, group.id);
      const error = (await setFormalRank(
        OTHER_MEMBER_TOKEN,
        rank.id,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('atomically swaps the active assignment, keeping the previous one in history with endedOn set', async () => {
      const {
        section,
        group,
        rank: rankA,
        token,
      } = await createGroupWithCatalog();
      await joinSection(token, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const rankB = await bodyOf<RankResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/ranks`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            track: RankTrack.ADULT,
            name: 'Corda Verde',
            description: null,
            previousRankId: rankA.id,
            cordSegments: oneSegment('#00FF00'),
          })
          .expect(201),
      );

      const first = (await setFormalRank(
        MEMBER_TOKEN,
        rankA.id,
      )) as FormalRankAssignmentResponseDto;
      const second = (await setFormalRank(
        MEMBER_TOKEN,
        rankB.id,
      )) as FormalRankAssignmentResponseDto;
      expect(second.isCurrent).toBe(true);
      expect(second.rank.id).toBe(rankB.id);

      const history = await bodyOf<FormalRankAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank-history')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      const ended = history.find((h) => h.id === first.id);
      expect(ended?.isCurrent).toBe(false);
      expect(ended?.endedOn).not.toBeNull();
      const current = history.find((h) => h.id === second.id);
      expect(current?.isCurrent).toBe(true);
    });
  });

  describe('DELETE /users/me/formal-rank', () => {
    it('ends the current formal rank, and repeating it 404s', async () => {
      const { section, group, rank, token } = await createGroupWithCatalog();
      await joinSection(token, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);
      await setFormalRank(MEMBER_TOKEN, rank.id);

      await request(app.getHttpServer())
        .delete('/api/v1/users/me/formal-rank')
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const current = await getCurrentFormalRank(MEMBER_TOKEN);
      expect(current).toBeNull();

      const repeat = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete('/api/v1/users/me/formal-rank')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(repeat.statusCode).toBe(404);
    });
  });

  // ─── Independent ("custom") cordão - singleton ─────────────────────────

  describe('Independent cordão (GET/PUT/DELETE /users/me/custom-rank)', () => {
    it('GET 404s with CUSTOM_RANK_NOT_SET when the caller has never set one', async () => {
      await ensureNoCustomRank(OUTSIDER_TOKEN);
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/custom-rank')
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('CUSTOM_RANK_NOT_SET');
    });

    it('DELETE 404s with CUSTOM_RANK_NOT_SET when the caller has never set one', async () => {
      await ensureNoCustomRank(OUTSIDER_TOKEN);
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete('/api/v1/users/me/custom-rank')
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('CUSTOM_RANK_NOT_SET');
    });

    it('can be set (PUT) even while an active formal group is set - setting is always allowed, and never carries formal-only fields', async () => {
      const { section, group, token } = await createGroupWithCatalog();
      await joinSection(token, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const created = (await setCustomRank(MEMBER_TOKEN, {
        name: 'Cordão pessoal',
      })) as CustomUserRankResponseDto;
      expect(created.name).toBe('Cordão pessoal');
      expect(created).not.toHaveProperty('isActive');
      expect(created).not.toHaveProperty('awardedByName');
      expect(created).not.toHaveProperty('startedOn');
      expect(created).not.toHaveProperty('endedOn');

      const current = await getCustomRank(MEMBER_TOKEN);
      expect(current?.id).toBe(created.id);
    });

    it('a second PUT updates the existing row in place rather than creating a second one - GET only ever returns the latest', async () => {
      await ensureNoCustomRank(OUTSIDER_TOKEN);
      const first = (await setCustomRank(OUTSIDER_TOKEN, {
        name: 'First cordão',
      })) as CustomUserRankResponseDto;

      const second = (await setCustomRank(OUTSIDER_TOKEN, {
        name: 'Second cordão',
        track: RankTrack.CHILD,
        cordSegments: oneSegment('#00FF00'),
      })) as CustomUserRankResponseDto;

      // Same underlying row (same id), updated in place - never a second
      // row, so there is no "old" one left to find.
      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Second cordão');
      expect(second.track).toBe(RankTrack.CHILD);

      const current = await getCustomRank(OUTSIDER_TOKEN);
      expect(current).toEqual(second);
    });

    it('can be freely edited (PUT) by the owner regardless of formal group status', async () => {
      const { section, group, token } = await createGroupWithCatalog();
      await joinSection(token, section.id, OTHER_MEMBER_TOKEN);
      await setFormalGroup(OTHER_MEMBER_TOKEN, group.id);

      const created = (await setCustomRank(OTHER_MEMBER_TOKEN, {
        name: 'Editable cordão',
      })) as CustomUserRankResponseDto;

      const updated = (await setCustomRank(OTHER_MEMBER_TOKEN, {
        name: 'Edited cordão',
        description: 'updated',
        track: RankTrack.CHILD,
        cordSegments: oneSegment('#ABCDEF'),
      })) as CustomUserRankResponseDto;
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Edited cordão');
      expect(updated.track).toBe(RankTrack.CHILD);
    });

    it('can always be deleted by the owner - never blocked as "in use" - and a repeat GET/DELETE 404s', async () => {
      await ensureNoCustomRank(OUTSIDER_TOKEN);
      await setCustomRank(OUTSIDER_TOKEN, { name: 'Deletable cordão' });

      await request(app.getHttpServer())
        .delete('/api/v1/users/me/custom-rank')
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(204);

      const afterDelete = await getCustomRank(OUTSIDER_TOKEN);
      expect(afterDelete).toBeNull();

      const repeatDelete = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete('/api/v1/users/me/custom-rank')
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(404),
      );
      expect(repeatDelete.code).toBe('CUSTOM_RANK_NOT_SET');
    });

    it('is fully scoped to the caller - one user setting/deleting theirs never affects another user', async () => {
      await ensureNoCustomRank(MEMBER_TOKEN);
      await ensureNoCustomRank(OTHER_MEMBER_TOKEN);

      await setCustomRank(MEMBER_TOKEN, { name: "Member's cordão" });
      const otherError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/custom-rank')
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(otherError.code).toBe('CUSTOM_RANK_NOT_SET');

      await setCustomRank(OTHER_MEMBER_TOKEN, {
        name: "Other member's cordão",
      });
      const memberStill = await getCustomRank(MEMBER_TOKEN);
      expect(memberStill?.name).toBe("Member's cordão");

      await request(app.getHttpServer())
        .delete('/api/v1/users/me/custom-rank')
        .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
        .expect(204);
      const memberUnaffected = await getCustomRank(MEMBER_TOKEN);
      expect(memberUnaffected?.name).toBe("Member's cordão");
    });

    it('selecting a formal rank no longer touches the independent cordão at all - the two are fully decoupled', async () => {
      await ensureNoFormalGroup(MEMBER_TOKEN);
      await ensureNoCustomRank(MEMBER_TOKEN);
      const cordao = (await setCustomRank(MEMBER_TOKEN, {
        name: 'Cordão before formal',
      })) as CustomUserRankResponseDto;

      const { section, group, rank, token } = await createGroupWithCatalog();
      await joinSection(token, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);
      await setFormalRank(MEMBER_TOKEN, rank.id);

      const afterFormal = await getCustomRank(MEMBER_TOKEN);
      expect(afterFormal).toEqual(cordao);

      await leaveSection(section.id, MEMBER_TOKEN);
      await endFormalGroup(MEMBER_TOKEN);

      const afterLeaving = await getCustomRank(MEMBER_TOKEN);
      expect(afterLeaving).toEqual(cordao);
    });
  });
});
