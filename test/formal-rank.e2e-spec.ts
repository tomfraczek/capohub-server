/**
 * E2E tests for the user's formal rank (FormalRankAssignment - always a
 * catalog Rank) and CustomUserRank (a cosmetic, non-historical "custom
 * cordão").
 *
 * Scenarios:
 *  1. A formal rank can only be set with an active formal group, from
 *     that exact group's catalog - a rank from a different group is
 *     rejected; one active assignment at a time, atomic swap preserves
 *     history
 *  2. A custom cordão can be created/edited/deleted freely by its owner
 *     regardless of formal-group status, but can only be *activated*
 *     without an active formal group
 *  3. Selecting a formal rank deactivates the active custom cordão;
 *     leaving the formal group afterwards does not restore it
 *  4. awardedByName/startedOn/endedOn belong only to the formal rank - a
 *     custom cordão never has them
 *  5. An archived catalog Rank cannot be newly selected, but stays valid
 *     as the current/historical formal rank if it was already selected
 *  6. IDOR: a CustomUserRank is invisible/unusable to anyone but its owner
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

const OWNER_TOKEN = 'valid-frank-owner-token';
const MEMBER_TOKEN = 'valid-frank-member-token';
const OTHER_MEMBER_TOKEN = 'valid-frank-other-member-token';
const OUTSIDER_TOKEN = 'valid-frank-outsider-token';

const TOKENS = [OWNER_TOKEN, MEMBER_TOKEN, OTHER_MEMBER_TOKEN, OUTSIDER_TOKEN];

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
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
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
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
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

  async function createGroup(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send(groupPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
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
    group: GroupResponseDto;
    section: SectionResponseDto;
    rank: RankResponseDto;
  }> {
    const group = await createGroup(OWNER_TOKEN, {
      name: `Catalog Group ${Date.now()}-${Math.random()}`,
    });
    const section = await createSection(OWNER_TOKEN, group.id);
    await bodyOf<GraduationSystemResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/graduation-system`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ name: 'System' })
        .expect(201),
    );
    const rank = await bodyOf<RankResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          track: RankTrack.ADULT,
          name: 'Corda Crua',
          description: null,
          previousRankId: null,
          cordSegments: oneSegment(),
        })
        .expect(201),
    );
    return { group, section, rank };
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

  async function createCustomCordao(
    token: string,
    overrides: Record<string, unknown> = {},
    expectStatus = 201,
  ): Promise<CustomUserRankResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .post('/api/v1/users/me/custom-ranks')
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
      const { section, group } = await createGroupWithCatalog();
      const otherCatalog = await createGroupWithCatalog();

      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const error = (await setFormalRank(
        MEMBER_TOKEN,
        otherCatalog.rank.id,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('sets a formal rank, persisting awardedByName and startedOn into history', async () => {
      const { section, group, rank } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
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
      const { section, group, rank } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);
      await setFormalRank(MEMBER_TOKEN, rank.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks/${rank.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const current = await getCurrentFormalRank(MEMBER_TOKEN);
      expect(current?.rank.id).toBe(rank.id);
      expect(current?.rank.isArchived).toBe(true);

      await joinSection(OWNER_TOKEN, section.id, OTHER_MEMBER_TOKEN);
      await setFormalGroup(OTHER_MEMBER_TOKEN, group.id);
      const error = (await setFormalRank(
        OTHER_MEMBER_TOKEN,
        rank.id,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('atomically swaps the active assignment, keeping the previous one in history with endedOn set', async () => {
      const { section, group, rank: rankA } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const rankB = await bodyOf<RankResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/ranks`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
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
      const { section, group, rank } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
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

  // ─── Custom cordão ───────────────────────────────────────────────────────

  describe('Custom cordão', () => {
    it('can be created even while an active formal group is set - creation is always allowed', async () => {
      const { section, group } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const created = (await createCustomCordao(
        MEMBER_TOKEN,
        { name: 'Cordão pessoal' },
        201,
      )) as CustomUserRankResponseDto;
      expect(created.name).toBe('Cordão pessoal');
      expect(created.isActive).toBe(false);
    });

    it('rejects activating a custom cordão while an active formal group is set', async () => {
      const { section, group } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);

      const created = (await createCustomCordao(
        MEMBER_TOKEN,
      )) as CustomUserRankResponseDto;

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/users/me/custom-ranks/${created.id}/activate`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(409),
      );
      expect(error.statusCode).toBe(409);
    });

    it('creates and activates an own custom cordão when there is no formal group', async () => {
      await ensureNoFormalGroup(OUTSIDER_TOKEN);
      const custom = (await createCustomCordao(OUTSIDER_TOKEN, {
        name: 'Corda Independente',
      })) as CustomUserRankResponseDto;
      expect(custom.isActive).toBe(false);

      const activated = await bodyOf<CustomUserRankResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/users/me/custom-ranks/${custom.id}/activate`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(201),
      );
      expect(activated.isActive).toBe(true);
      expect(activated).not.toHaveProperty('awardedByName');
      expect(activated).not.toHaveProperty('startedOn');
      expect(activated).not.toHaveProperty('endedOn');
    });

    it('activating one cordão deactivates whichever was active before', async () => {
      await ensureNoFormalGroup(OTHER_MEMBER_TOKEN);
      const first = (await createCustomCordao(OTHER_MEMBER_TOKEN, {
        name: 'First cordão',
      })) as CustomUserRankResponseDto;
      const second = (await createCustomCordao(OTHER_MEMBER_TOKEN, {
        name: 'Second cordão',
      })) as CustomUserRankResponseDto;

      await request(app.getHttpServer())
        .post(`/api/v1/users/me/custom-ranks/${first.id}/activate`)
        .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/users/me/custom-ranks/${second.id}/activate`)
        .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
        .expect(201);

      const firstAfter = await bodyOf<CustomUserRankResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/custom-ranks/${first.id}`)
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(firstAfter.isActive).toBe(false);
      const secondAfter = await bodyOf<CustomUserRankResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/custom-ranks/${second.id}`)
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(secondAfter.isActive).toBe(true);
    });

    it('selecting a formal rank deactivates the active custom cordão, and leaving the group does not restore it', async () => {
      await ensureNoFormalGroup(MEMBER_TOKEN);
      const cordao = (await createCustomCordao(MEMBER_TOKEN, {
        name: 'Cordão before formal',
      })) as CustomUserRankResponseDto;
      await request(app.getHttpServer())
        .post(`/api/v1/users/me/custom-ranks/${cordao.id}/activate`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(201);

      const { section, group, rank } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group.id);
      await setFormalRank(MEMBER_TOKEN, rank.id);

      const afterFormal = await bodyOf<CustomUserRankResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/custom-ranks/${cordao.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(afterFormal.isActive).toBe(false);

      await leaveSection(section.id, MEMBER_TOKEN);
      await endFormalGroup(MEMBER_TOKEN);

      const afterLeaving = await bodyOf<CustomUserRankResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/custom-ranks/${cordao.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(afterLeaving.isActive).toBe(false);

      // Now that there is no formal group again, the user can manually
      // reactivate it - it was never deleted, only deactivated.
      const reactivated = await bodyOf<CustomUserRankResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/users/me/custom-ranks/${cordao.id}/activate`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(201),
      );
      expect(reactivated.isActive).toBe(true);
    });

    it('can be freely edited by the owner regardless of formal group status', async () => {
      const { section, group } = await createGroupWithCatalog();
      await joinSection(OWNER_TOKEN, section.id, OTHER_MEMBER_TOKEN);
      await setFormalGroup(OTHER_MEMBER_TOKEN, group.id);

      const created = (await createCustomCordao(OTHER_MEMBER_TOKEN, {
        name: 'Editable cordão',
      })) as CustomUserRankResponseDto;

      const updated = await bodyOf<CustomUserRankResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/custom-ranks/${created.id}`)
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .send({
            name: 'Edited cordão',
            description: 'updated',
            track: RankTrack.CHILD,
            cordSegments: oneSegment('#ABCDEF'),
          })
          .expect(200),
      );
      expect(updated.name).toBe('Edited cordão');
      expect(updated.track).toBe(RankTrack.CHILD);
    });

    it('can always be deleted by the owner, active or not - never blocked as "in use"', async () => {
      await ensureNoFormalGroup(OUTSIDER_TOKEN);
      const created = (await createCustomCordao(OUTSIDER_TOKEN, {
        name: 'Deletable cordão',
      })) as CustomUserRankResponseDto;
      await request(app.getHttpServer())
        .post(`/api/v1/users/me/custom-ranks/${created.id}/activate`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/custom-ranks/${created.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/users/me/custom-ranks/${created.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('IDOR: a custom cordão is invisible and unusable to anyone but its owner', async () => {
      const custom = (await createCustomCordao(OUTSIDER_TOKEN, {
        name: 'Private cordão',
      })) as CustomUserRankResponseDto;
      // MEMBER_TOKEN (the attacker below) may still have an active formal
      // group left over from an earlier test in this file - clear it so
      // every attempt below fails for the IDOR reason (404), never a
      // formal-group precondition.
      await ensureNoFormalGroup(MEMBER_TOKEN);

      const getError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/custom-ranks/${custom.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(getError.statusCode).toBe(404);

      const patchError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/custom-ranks/${custom.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({
            name: 'Hijacked',
            description: null,
            track: RankTrack.ADULT,
            cordSegments: oneSegment(),
          })
          .expect(404),
      );
      expect(patchError.statusCode).toBe(404);

      const activateError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/users/me/custom-ranks/${custom.id}/activate`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(activateError.statusCode).toBe(404);

      const deactivateError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/users/me/custom-ranks/${custom.id}/deactivate`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(deactivateError.statusCode).toBe(404);

      const deleteError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/users/me/custom-ranks/${custom.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(deleteError.statusCode).toBe(404);
    });
  });
});
