/**
 * E2E tests for GET /sections/:sectionId/members/:membershipId/formal-rank
 * - the Section OWNER/ADMIN prep view for the formal-rank-correction
 * workflow.
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
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { closeE2eApp } from './close-e2e-app.helper';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { SectionMembershipResponseDto } from '../src/groups/dto/section-membership-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import { RankResponseDto } from '../src/graduation/dto/rank-response.dto';
import { SectionMemberFormalRankResponseDto } from '../src/graduation/dto/section-member-formal-rank-response.dto';
import { GraduationSystem } from '../src/graduation/entities/graduation-system.entity';
import { Rank } from '../src/graduation/entities/rank.entity';
import { FormalRankAssignment } from '../src/graduation/entities/formal-rank-assignment.entity';
import { FormalRankCorrectionRequest } from '../src/graduation/entities/formal-rank-correction-request.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { FormalRankCorrectionStatus } from '../src/graduation/enums/formal-rank-correction-status.enum';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';

const OWNER_TOKEN = 'valid-smfr-owner-token';
const ADMIN_TOKEN = 'valid-smfr-admin-token';
const INSTRUCTOR_TOKEN = 'valid-smfr-instructor-token';
const ASSISTANT_TOKEN = 'valid-smfr-assistant-token';
const MEMBER_TOKEN = 'valid-smfr-member-token';
const TARGET_TOKEN = 'valid-smfr-target-token';
const OUTSIDE_OWNER_TOKEN = 'valid-smfr-outside-owner-token';
// Dedicated to the "no active formal rank" test below - TARGET_TOKEN is
// reused across every other test via setupSectionWithTarget(), and a
// FormalRankAssignment is a single global-per-user active record (never
// per-Section), so TARGET_TOKEN itself always has one by the time later
// tests run.
const NO_RANK_TARGET_TOKEN = 'valid-smfr-no-rank-target-token';

const TOKENS = [
  OWNER_TOKEN,
  ADMIN_TOKEN,
  INSTRUCTOR_TOKEN,
  ASSISTANT_TOKEN,
  MEMBER_TOKEN,
  NO_RANK_TARGET_TOKEN,
  TARGET_TOKEN,
  OUTSIDE_OWNER_TOKEN,
];

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
    if (auth) return Promise.resolve(auth);
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

describe('Section Member Formal Rank (admin) (e2e)', () => {
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
      await cleanup.nativeDelete(Notification, {
        recipient: { $in: [...localUserIdByToken.values()] },
      });
      await cleanup.nativeDelete(FormalRankCorrectionRequest, {
        targetUser: { $in: [...localUserIdByToken.values()] },
      });
      await cleanup.nativeDelete(FormalRankAssignment, {
        user: { $in: [...localUserIdByToken.values()] },
      });

      const systems = await cleanup.find(GraduationSystem, {
        group: { $in: createdGroupIds },
      });
      const systemIds = systems.map((s) => s.id);
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
      name: 'SMFR Test Group',
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
      name: 'SMFR Test Section',
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

  async function grantSectionRole(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function membershipIdFor(
    sectionId: string,
    userToken: string,
  ): Promise<string> {
    const members = await bodyOf<SectionMembershipResponseDto[]>(
      request(app.getHttpServer())
        .get(`/api/v1/sections/${sectionId}/members`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );
    const userId = localUserIdByToken.get(userToken);
    const membership = members.find((m) => m.user.id === userId);
    if (!membership) {
      throw new Error(
        `No membership found for ${userToken} in section ${sectionId}`,
      );
    }
    return membership.id;
  }

  async function setFormalGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId })
      .expect(200);
  }

  async function createSystem(
    groupId: string,
  ): Promise<GraduationSystemResponseDto> {
    return bodyOf<GraduationSystemResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/graduation-system`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ name: 'System' })
        .expect(201),
    );
  }

  async function createRank(
    groupId: string,
    body: Record<string, unknown>,
  ): Promise<RankResponseDto> {
    return bodyOf<RankResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/ranks`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(body)
        .expect(201),
    );
  }

  async function setFormalRank(token: string, rankId: string): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/v1/users/me/formal-rank')
      .set('Authorization', `Bearer ${token}`)
      .send({ rankId })
      .expect(200);
  }

  async function getMemberFormalRank(
    sectionId: string,
    membershipId: string,
    token: string,
    expectStatus = 200,
  ): Promise<SectionMemberFormalRankResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .get(
          `/api/v1/sections/${sectionId}/members/${membershipId}/formal-rank`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(expectStatus),
    );
  }

  /**
   * Fresh Group + Section + catalog, with OWNER/ADMIN/INSTRUCTOR/
   * ASSISTANT/MEMBER/TARGET all joined; TARGET has a formal group + formal
   * rank set. Tokens are reused across tests, so every test builds its own
   * clean Group/Section.
   */
  async function setupSectionWithTarget(): Promise<{
    group: GroupResponseDto;
    section: SectionResponseDto;
    rankA: RankResponseDto;
    rankB: RankResponseDto;
    targetMembershipId: string;
  }> {
    const group = await createGroup(OWNER_TOKEN, {
      name: `SMFR Group ${Date.now()}-${Math.random()}`,
    });
    const section = await createSection(OWNER_TOKEN, group.id);
    await createSystem(group.id);
    const rankA = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Corda Crua',
      description: null,
      previousRankId: null,
      cordSegments: oneSegment(),
    });
    const rankB = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Corda Verde',
      description: null,
      previousRankId: rankA.id,
      cordSegments: oneSegment('#00FF00'),
    });

    await joinSection(OWNER_TOKEN, section.id, ADMIN_TOKEN);
    await grantSectionRole(
      OWNER_TOKEN,
      section.id,
      ADMIN_TOKEN,
      GroupRole.ADMIN,
    );
    await joinSection(OWNER_TOKEN, section.id, INSTRUCTOR_TOKEN);
    await grantSectionRole(
      OWNER_TOKEN,
      section.id,
      INSTRUCTOR_TOKEN,
      GroupRole.INSTRUCTOR,
    );
    await joinSection(OWNER_TOKEN, section.id, ASSISTANT_TOKEN);
    await grantSectionRole(
      OWNER_TOKEN,
      section.id,
      ASSISTANT_TOKEN,
      GroupRole.ASSISTANT,
    );
    await joinSection(OWNER_TOKEN, section.id, MEMBER_TOKEN);
    await joinSection(OWNER_TOKEN, section.id, TARGET_TOKEN);

    await setFormalGroup(TARGET_TOKEN, group.id);
    await setFormalRank(TARGET_TOKEN, rankA.id);

    const targetMembershipId = await membershipIdFor(section.id, TARGET_TOKEN);

    return { group, section, rankA, rankB, targetMembershipId };
  }

  it('lets the Section OWNER see the current formal rank of a member', async () => {
    const { group, section, rankA, targetMembershipId } =
      await setupSectionWithTarget();

    const result = (await getMemberFormalRank(
      section.id,
      targetMembershipId,
      OWNER_TOKEN,
    )) as SectionMemberFormalRankResponseDto;

    expect(result.user.id).toBe(localUserIdByToken.get(TARGET_TOKEN));
    expect(result.formalGroup).toEqual({ id: group.id, name: group.name });
    expect(result.formalRank?.rank.id).toBe(rankA.id);
    expect(result.formalRank?.rank.name).toBe('Corda Crua');
    // formalRank.rank must be self-sufficient for the frontend to render
    // the cordão without a second request - id/name/track/cordSegments
    // (each with position/colorHex/proportion), not just a bare ref.
    expect(result.formalRank?.rank.track).toBe(RankTrack.ADULT);
    expect(result.formalRank?.rank.cordSegments).toEqual([
      { position: 1, colorHex: '#123456', proportion: 100 },
    ]);
    expect(result.correction).toBeNull();
  });

  it('lets the Section ADMIN see the current formal rank of a member', async () => {
    const { section, rankA, targetMembershipId } =
      await setupSectionWithTarget();

    const result = (await getMemberFormalRank(
      section.id,
      targetMembershipId,
      ADMIN_TOKEN,
    )) as SectionMemberFormalRankResponseDto;

    expect(result.formalRank?.rank.id).toBe(rankA.id);
  });

  it('rejects INSTRUCTOR, ASSISTANT, and plain MEMBER (403)', async () => {
    const { section, targetMembershipId } = await setupSectionWithTarget();

    for (const token of [INSTRUCTOR_TOKEN, ASSISTANT_TOKEN, MEMBER_TOKEN]) {
      const error = (await getMemberFormalRank(
        section.id,
        targetMembershipId,
        token,
        403,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(403);
    }
  });

  it('rejects a Group ADMIN with no local Section role (404 - no inheritance from the parent Group)', async () => {
    const { group, section, targetMembershipId } =
      await setupSectionWithTarget();

    // Granted on the exact parent Group of `section`, never on the Section
    // itself - RoleAssignmentsService.resolveAuthorization never inherits
    // a Section's authorization from its parent Group (see
    // group-permissions.guard.ts).
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${group.id}/role-assignments`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({
        userId: localUserIdByToken.get(OUTSIDE_OWNER_TOKEN),
        role: GroupRole.ADMIN,
      })
      .expect(201);

    const error = (await getMemberFormalRank(
      section.id,
      targetMembershipId,
      OUTSIDE_OWNER_TOKEN,
      404,
    )) as HttpErrorResponse;
    expect(error.statusCode).toBe(404);
  });

  it('rejects a membershipId that belongs to a different Section (404, cross-Section IDOR)', async () => {
    const first = await setupSectionWithTarget();
    const second = await setupSectionWithTarget();

    const error = (await getMemberFormalRank(
      first.section.id,
      second.targetMembershipId,
      OWNER_TOKEN,
      404,
    )) as HttpErrorResponse;
    expect(error.statusCode).toBe(404);
  });

  it('returns formalRank: null when the member has no active formal rank', async () => {
    const group = await createGroup(OWNER_TOKEN, {
      name: `SMFR No Rank Group ${Date.now()}`,
    });
    const section = await createSection(OWNER_TOKEN, group.id);
    await joinSection(OWNER_TOKEN, section.id, NO_RANK_TARGET_TOKEN);
    const membershipId = await membershipIdFor(
      section.id,
      NO_RANK_TARGET_TOKEN,
    );

    const result = (await getMemberFormalRank(
      section.id,
      membershipId,
      OWNER_TOKEN,
    )) as SectionMemberFormalRankResponseDto;

    expect(result.formalRank).toBeNull();
    expect(result.correction).toBeNull();
  });

  it('returns the active correction state when one exists for the member', async () => {
    const { section, rankB, targetMembershipId } =
      await setupSectionWithTarget();

    const created = await bodyOf<{ id: string }>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/formal-rank-corrections`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ targetUserId: localUserIdByToken.get(TARGET_TOKEN) })
        .expect(201),
    );

    const beforeSubmit = (await getMemberFormalRank(
      section.id,
      targetMembershipId,
      OWNER_TOKEN,
    )) as SectionMemberFormalRankResponseDto;
    expect(beforeSubmit.correction?.id).toBe(created.id);
    expect(beforeSubmit.correction?.status).toBe(
      FormalRankCorrectionStatus.CORRECTION_REQUIRED,
    );
    expect(beforeSubmit.correction?.proposedRank).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/users/me/formal-rank-correction/submit')
      .set('Authorization', `Bearer ${TARGET_TOKEN}`)
      .send({ rankId: rankB.id, awardedByName: null })
      .expect(201);

    const afterSubmit = (await getMemberFormalRank(
      section.id,
      targetMembershipId,
      OWNER_TOKEN,
    )) as SectionMemberFormalRankResponseDto;
    expect(afterSubmit.correction?.status).toBe(
      FormalRankCorrectionStatus.PENDING_APPROVAL,
    );
    expect(afterSubmit.correction?.proposedRank?.id).toBe(rankB.id);
  });

  it('never exposes email, phone, clerkUserId, or other roles in the response', async () => {
    const { section, targetMembershipId } = await setupSectionWithTarget();

    const raw = await bodyOf<Record<string, unknown>>(
      request(app.getHttpServer())
        .get(
          `/api/v1/sections/${section.id}/members/${targetMembershipId}/formal-rank`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );
    const json = JSON.stringify(raw);
    expect(json).not.toContain('email');
    expect(json).not.toContain('clerkUserId');
    expect(json).not.toContain('phone');
    expect(raw).not.toHaveProperty('roles');
  });

  it('returns 401 for an unauthenticated request', async () => {
    const { section, targetMembershipId } = await setupSectionWithTarget();

    await request(app.getHttpServer())
      .get(
        `/api/v1/sections/${section.id}/members/${targetMembershipId}/formal-rank`,
      )
      .expect(401);
  });
});
