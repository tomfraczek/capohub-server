/**
 * E2E tests for the formal rank correction workflow
 * (FormalRankCorrectionRequest) - fixing a misrecorded
 * FormalRankAssignment.rank, never a new award.
 *
 * Scenarios:
 *  1. Request: Section OWNER/ADMIN can report; an ADMIN of a different
 *     Section, or a target outside the exact Section, cannot; a target
 *     with no active formal rank cannot be reported; duplicate active
 *     requests are rejected
 *  2. Submit: the target can only submit a Rank from their current formal
 *     group's catalog; archived Ranks are rejected; the
 *     FormalRankAssignment itself is never touched at this step
 *  3. Review (variant C): OWNER approves/rejects any request; an ADMIN
 *     only their own report; approve modifies the *same*
 *     FormalRankAssignment (rank changes, startedOn/endedOn don't, no new
 *     history row); reject allows resubmission on the same request
 *  4. Visibility: FormalRankCorrectionService.isPubliclyVisible() is false
 *     during CORRECTION_REQUIRED/PENDING_APPROVAL, true otherwise
 *  5. Loss of authorization: target leaving the Section blocks review
 *     without touching the FormalRankAssignment; an ADMIN losing their
 *     role can no longer review, OWNER still can
 *  6. Race conditions: two concurrent requests for the same assignment;
 *     concurrent approve/reject
 *  7. Notifications and Audit Log: correct recipients, deduplicated,
 *     never "all Section admins", always logged under the exact Section
 */
import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import type { EntityManager as SqlEntityManager } from '@mikro-orm/postgresql';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import { closeE2eApp } from './close-e2e-app.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { AuditAction } from '../src/groups/enums/audit-action.enum';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import { RankResponseDto } from '../src/graduation/dto/rank-response.dto';
import { FormalRankCorrectionResponseDto } from '../src/graduation/dto/formal-rank-correction-response.dto';
import { FormalRankCorrectionOwnResponseDto } from '../src/graduation/dto/formal-rank-correction-own-response.dto';
import { GraduationSystem } from '../src/graduation/entities/graduation-system.entity';
import { Rank } from '../src/graduation/entities/rank.entity';
import { FormalRankAssignment } from '../src/graduation/entities/formal-rank-assignment.entity';
import { FormalRankCorrectionRequest } from '../src/graduation/entities/formal-rank-correction-request.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationTargetType } from '../src/notifications/enums/notification-target-type.enum';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
import { FormalRankCorrectionStatus } from '../src/graduation/enums/formal-rank-correction-status.enum';
import { FormalRankCorrectionService } from '../src/graduation/formal-rank-correction.service';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';

const OWNER_TOKEN = 'valid-frc-owner-token';
const ADMIN1_TOKEN = 'valid-frc-admin1-token';
const ADMIN2_TOKEN = 'valid-frc-admin2-token';
const TARGET_TOKEN = 'valid-frc-target-token';
const OUTSIDER_TOKEN = 'valid-frc-outsider-token';

const TOKENS = [
  OWNER_TOKEN,
  ADMIN1_TOKEN,
  ADMIN2_TOKEN,
  TARGET_TOKEN,
  OUTSIDER_TOKEN,
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

describe('Formal Rank Correction (e2e)', () => {
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
      name: 'FRC Test Group',
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
      name: 'FRC Test Section',
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

  async function grantSectionRole(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<RoleAssignmentResponseDto> {
    return bodyOf<RoleAssignmentResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/role-assignments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: localUserIdByToken.get(memberToken), role })
        .expect(201),
    );
  }

  async function revokeSectionRole(
    ownerToken: string,
    sectionId: string,
    roleAssignmentId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .delete(
        `/api/v1/sections/${sectionId}/role-assignments/${roleAssignmentId}`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
  }

  async function setFormalGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId })
      .expect(200);
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

  /**
   * Builds a fresh Group + catalog (two Ranks) + Section, joins TARGET,
   * sets TARGET's formal group and formal rank to `rankA`. Returns enough
   * to drive the correction workflow against a clean target every time
   * (tokens are reused across tests in this file).
   */
  async function setupTargetWithFormalRank(): Promise<{
    group: GroupResponseDto;
    section: SectionResponseDto;
    rankA: RankResponseDto;
    rankB: RankResponseDto;
  }> {
    const group = await createGroup(OWNER_TOKEN, {
      name: `FRC Group ${Date.now()}-${Math.random()}`,
    });
    const section = await createSection(OWNER_TOKEN, group.id);
    await bodyOf<GraduationSystemResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/graduation-system`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ name: 'System' })
        .expect(201),
    );
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

    await joinSection(OWNER_TOKEN, section.id, TARGET_TOKEN);
    await setFormalGroup(TARGET_TOKEN, group.id);
    await setFormalRank(TARGET_TOKEN, rankA.id);

    return { group, section, rankA, rankB };
  }

  async function requestCorrection(
    sectionId: string,
    token: string,
    expectStatus = 201,
    body: Record<string, unknown> = {},
  ): Promise<FormalRankCorrectionResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/formal-rank-corrections`)
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUserId: localUserIdByToken.get(TARGET_TOKEN), ...body })
        .expect(expectStatus),
    );
  }

  // ─── Request ─────────────────────────────────────────────────────────────

  describe('Requesting a correction', () => {
    it('lets the Section OWNER report a target formal rank', async () => {
      const { section } = await setupTargetWithFormalRank();
      const created = (await requestCorrection(
        section.id,
        OWNER_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      expect(created.status).toBe(
        FormalRankCorrectionStatus.CORRECTION_REQUIRED,
      );
      expect(created.currentRank.name).toBe('Corda Crua');
      expect(created.proposedRank).toBeNull();
    });

    it('lets a Section ADMIN report a target formal rank', async () => {
      const { section } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN1_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN1_TOKEN,
        GroupRole.ADMIN,
      );

      const created = (await requestCorrection(
        section.id,
        ADMIN1_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      expect(created.reportedBy?.id).toBe(localUserIdByToken.get(ADMIN1_TOKEN));
    });

    it('rejects an ADMIN of a different Section (404 - no cross-section authorization)', async () => {
      const { section } = await setupTargetWithFormalRank();
      const otherGroup = await createGroup(OWNER_TOKEN, {
        name: 'Other FRC Group',
      });
      const otherSection = await createSection(OWNER_TOKEN, otherGroup.id);
      await joinSection(OWNER_TOKEN, otherSection.id, ADMIN2_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        otherSection.id,
        ADMIN2_TOKEN,
        GroupRole.ADMIN,
      );

      const error = (await requestCorrection(
        section.id,
        ADMIN2_TOKEN,
        404,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(404);
    });

    it('rejects a target who is not an active member of this exact Section', async () => {
      const { section } = await setupTargetWithFormalRank();
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/formal-rank-corrections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ targetUserId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(409),
      );
      expect(error.statusCode).toBe(409);
    });

    it('rejects a target with no active formal rank', async () => {
      const group = await createGroup(OWNER_TOKEN, { name: 'No Rank Group' });
      const section = await createSection(OWNER_TOKEN, group.id);
      await joinSection(OWNER_TOKEN, section.id, OUTSIDER_TOKEN);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/formal-rank-corrections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ targetUserId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(409),
      );
      expect(error.statusCode).toBe(409);
    });

    it('rejects a duplicate active request for the same formal rank assignment', async () => {
      const { section } = await setupTargetWithFormalRank();
      await requestCorrection(section.id, OWNER_TOKEN);

      const error = (await requestCorrection(
        section.id,
        OWNER_TOKEN,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('notifies only the target on request - never all Section admins', async () => {
      const { section } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN2_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN2_TOKEN,
        GroupRole.ADMIN,
      );

      const created = (await requestCorrection(
        section.id,
        OWNER_TOKEN,
      )) as FormalRankCorrectionResponseDto;

      const em = app.get(EntityManager).fork();
      const notifications = await em.find(Notification, {
        targetType: NotificationTargetType.FORMAL_RANK_CORRECTION,
        targetId: created.id,
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].recipient.id).toBe(
        localUserIdByToken.get(TARGET_TOKEN),
      );
      expect(notifications[0].type).toBe(
        NotificationType.FORMAL_RANK_CORRECTION_REQUIRED,
      );

      const auditEntries = await em.find(AuditLogEntry, {
        section: section.id,
        action: AuditAction.REQUEST_FORMAL_RANK_CORRECTION,
      });
      expect(auditEntries.length).toBeGreaterThanOrEqual(1);
      const entry = auditEntries.find(
        (e) => e.metadata?.requestId === created.id,
      );
      expect(entry?.metadata).toMatchObject({
        requestId: created.id,
        targetUserId: localUserIdByToken.get(TARGET_TOKEN),
      });
      expect(entry?.group).toBeNull();
    });
  });

  // ─── Submit ──────────────────────────────────────────────────────────────

  describe('Submitting a correction', () => {
    it('accepts a Rank from the current formal group catalog, without touching the FormalRankAssignment yet', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      await requestCorrection(section.id, OWNER_TOKEN);

      const submitted = await bodyOf<FormalRankCorrectionOwnResponseDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/formal-rank-correction/submit')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .send({ rankId: rankB.id })
          .expect(201),
      );
      expect(submitted.status).toBe(
        FormalRankCorrectionStatus.PENDING_APPROVAL,
      );
      expect(submitted.proposedRank?.id).toBe(rankB.id);

      const current = await bodyOf<{ rank: { id: string } }>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );
      expect(current.rank.id).not.toBe(rankB.id);
    });

    it('rejects a Rank from a different group', async () => {
      const { section } = await setupTargetWithFormalRank();
      await requestCorrection(section.id, OWNER_TOKEN);
      const otherGroup = await createGroup(OWNER_TOKEN, {
        name: 'Unrelated Catalog Group',
      });
      await bodyOf<GraduationSystemResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${otherGroup.id}/graduation-system`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Other system' })
          .expect(201),
      );
      const foreignRank = await createRank(otherGroup.id, {
        track: RankTrack.ADULT,
        name: 'Foreign Rank',
        description: null,
        previousRankId: null,
        cordSegments: oneSegment(),
      });

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/formal-rank-correction/submit')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .send({ rankId: foreignRank.id })
          .expect(409),
      );
      expect(error.statusCode).toBe(409);
    });

    it('rejects an archived Rank', async () => {
      const { section, rankB, group } = await setupTargetWithFormalRank();
      await requestCorrection(section.id, OWNER_TOKEN);
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks/${rankB.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/formal-rank-correction/submit')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .send({ rankId: rankB.id })
          .expect(409),
      );
      expect(error.statusCode).toBe(409);
    });

    it('notifies the reporter and the Section OWNER, deduplicated when they are the same person', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      // OWNER_TOKEN both reports and is the Section OWNER - the SUBMITTED
      // notification must be deduplicated to a single row for them.
      const created = (await requestCorrection(
        section.id,
        OWNER_TOKEN,
      )) as FormalRankCorrectionResponseDto;

      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      const em = app.get(EntityManager).fork();
      const notifications = await em.find(
        Notification,
        {
          targetType: NotificationTargetType.FORMAL_RANK_CORRECTION,
          targetId: created.id,
          type: NotificationType.FORMAL_RANK_CORRECTION_SUBMITTED,
        },
        { populate: ['contextSection'] },
      );
      expect(notifications).toHaveLength(1);
      expect(notifications[0].recipient.id).toBe(
        localUserIdByToken.get(OWNER_TOKEN),
      );

      // Deep-link contract: targetId + contextSection alone must be enough
      // to resolve straight to the admin review screen, with no listing/
      // guessing - GET .../formal-rank-corrections/:requestId already takes
      // exactly those two identifiers.
      expect(notifications[0].contextSection?.id).toBe(section.id);
      const reviewTarget = await bodyOf<FormalRankCorrectionResponseDto>(
        request(app.getHttpServer())
          .get(
            `/api/v1/sections/${notifications[0].contextSection!.id}/formal-rank-corrections/${notifications[0].targetId}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(reviewTarget.id).toBe(created.id);
      expect(reviewTarget.targetUser.id).toBe(
        localUserIdByToken.get(TARGET_TOKEN),
      );
    });
  });

  // ─── Review: variant C ───────────────────────────────────────────────────

  describe('Review - variant C (OWNER always, ADMIN only their own report)', () => {
    it('lets OWNER approve a request reported by an ADMIN, correcting the same assignment', async () => {
      const { section, rankA, rankB } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN1_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN1_TOKEN,
        GroupRole.ADMIN,
      );
      const created = (await requestCorrection(
        section.id,
        ADMIN1_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      const beforeHistory = await bodyOf<unknown[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank-history')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );

      const approved = await bodyOf<FormalRankCorrectionResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(approved.status).toBe(FormalRankCorrectionStatus.APPROVED);

      const current = await bodyOf<{
        rank: { id: string };
        startedOn: string | null;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );
      expect(current.rank.id).toBe(rankB.id);
      expect(current.rank.id).not.toBe(rankA.id);

      const afterHistory = await bodyOf<unknown[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank-history')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );
      // No new history row - the correction updated the existing one.
      expect(afterHistory).toHaveLength(beforeHistory.length);
    });

    it('lets the reporting ADMIN approve their own report', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN1_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN1_TOKEN,
        GroupRole.ADMIN,
      );
      const created = (await requestCorrection(
        section.id,
        ADMIN1_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
        )
        .set('Authorization', `Bearer ${ADMIN1_TOKEN}`)
        .expect(201);
    });

    it('rejects an ADMIN approving a report filed by a different ADMIN', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN1_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN1_TOKEN,
        GroupRole.ADMIN,
      );
      await joinSection(OWNER_TOKEN, section.id, ADMIN2_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN2_TOKEN,
        GroupRole.ADMIN,
      );

      const created = (await requestCorrection(
        section.id,
        ADMIN1_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
          )
          .set('Authorization', `Bearer ${ADMIN2_TOKEN}`)
          .expect(403),
      );
      expect(error.statusCode).toBe(403);
    });

    it('OWNER rejects, target resubmits on the same request, and the reporting ADMIN then rejects again', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN1_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN1_TOKEN,
        GroupRole.ADMIN,
      );
      const created = (await requestCorrection(
        section.id,
        ADMIN1_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      const rejected = await bodyOf<FormalRankCorrectionResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/reject`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ reason: 'Try again' })
          .expect(201),
      );
      expect(rejected.status).toBe(FormalRankCorrectionStatus.REJECTED);
      expect(rejected.rejectionReason).toBe('Try again');
      expect(rejected.id).toBe(created.id);

      const resubmitted = await bodyOf<FormalRankCorrectionOwnResponseDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/formal-rank-correction/submit')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .send({ rankId: rankB.id })
          .expect(201),
      );
      expect(resubmitted.id).toBe(created.id);
      expect(resubmitted.status).toBe(
        FormalRankCorrectionStatus.PENDING_APPROVAL,
      );

      const rejectedAgain = await bodyOf<FormalRankCorrectionResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/reject`,
          )
          .set('Authorization', `Bearer ${ADMIN1_TOKEN}`)
          .send({})
          .expect(201),
      );
      expect(rejectedAgain.id).toBe(created.id);
    });

    it("rejects an ADMIN rejecting someone else's report", async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN1_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN1_TOKEN,
        GroupRole.ADMIN,
      );
      await joinSection(OWNER_TOKEN, section.id, ADMIN2_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN2_TOKEN,
        GroupRole.ADMIN,
      );

      const created = (await requestCorrection(
        section.id,
        ADMIN1_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/reject`,
          )
          .set('Authorization', `Bearer ${ADMIN2_TOKEN}`)
          .send({})
          .expect(403),
      );
      expect(error.statusCode).toBe(403);
    });
  });

  // ─── Loss of authorization ────────────────────────────────────────────────

  describe('Loss of authorization does not silently mutate state', () => {
    it('blocks review once the target leaves the Section, without touching the FormalRankAssignment', async () => {
      const { section, rankA, rankB } = await setupTargetWithFormalRank();
      const created = (await requestCorrection(
        section.id,
        OWNER_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      await leaveSection(section.id, TARGET_TOKEN);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(error.statusCode).toBe(409);

      // The request is retained and still readable.
      const stillThere = await bodyOf<FormalRankCorrectionResponseDto>(
        request(app.getHttpServer())
          .get(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(stillThere.id).toBe(created.id);
      expect(stillThere.currentRank.id).toBe(rankA.id);
    });

    it('an ADMIN who lost their role can no longer review; OWNER still can', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      await joinSection(OWNER_TOKEN, section.id, ADMIN1_TOKEN);
      const grant = await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        ADMIN1_TOKEN,
        GroupRole.ADMIN,
      );
      const created = (await requestCorrection(
        section.id,
        ADMIN1_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      await revokeSectionRole(OWNER_TOKEN, section.id, grant.id);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
          )
          .set('Authorization', `Bearer ${ADMIN1_TOKEN}`)
          .expect(403),
      );
      expect(error.statusCode).toBe(403);

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
    });
  });

  // ─── Visibility contract ──────────────────────────────────────────────────

  describe('Visibility contract', () => {
    it('is hidden while CORRECTION_REQUIRED and PENDING_APPROVAL, visible again after APPROVED', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      const service = app.get(FormalRankCorrectionService);
      const em = app.get(EntityManager).fork() as unknown as SqlEntityManager;
      const assignment = await em.findOneOrFail(FormalRankAssignment, {
        user: localUserIdByToken.get(TARGET_TOKEN),
        endedOn: null,
      });

      expect(await service.isPubliclyVisible(assignment.id, em)).toBe(true);

      const created = (await requestCorrection(
        section.id,
        OWNER_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      expect(await service.isPubliclyVisible(assignment.id, em)).toBe(false);

      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);
      expect(await service.isPubliclyVisible(assignment.id, em)).toBe(false);

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      expect(await service.isPubliclyVisible(assignment.id, em)).toBe(true);
    });

    it("the owner's own view always shows the current rank, reporter, reason, and proposed rank while active", async () => {
      const { section, rankA, rankB } = await setupTargetWithFormalRank();
      await requestCorrection(section.id, OWNER_TOKEN, 201, {
        reason: 'Wrong belt',
      });

      const own = await bodyOf<FormalRankCorrectionOwnResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank-correction')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );
      expect(own.status).toBe(FormalRankCorrectionStatus.CORRECTION_REQUIRED);
      expect(own.reason).toBe('Wrong belt');
      expect(own.currentRank.id).toBe(rankA.id);
      expect(own.proposedRank).toBeNull();
      expect(own.catalogGroupId).toBeDefined();

      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      const afterSubmit = await bodyOf<FormalRankCorrectionOwnResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank-correction')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );
      expect(afterSubmit.proposedRank?.id).toBe(rankB.id);
    });

    it('404s the own-view once there is no active correction (e.g. before any request, or after approval)', async () => {
      await setupTargetWithFormalRank();
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/formal-rank-correction')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(404),
      );
      expect(error.statusCode).toBe(404);
    });
  });

  // ─── List/filter ───────────────────────────────────────────────────────────

  describe('Section admin list', () => {
    it('filters by status and paginates', async () => {
      const { section } = await setupTargetWithFormalRank();
      await requestCorrection(section.id, OWNER_TOKEN);

      const page = await bodyOf<
        PaginatedResponse<FormalRankCorrectionResponseDto>
      >(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/formal-rank-corrections`)
          .query({
            status: FormalRankCorrectionStatus.CORRECTION_REQUIRED,
            page: 1,
            limit: 10,
          })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(page.data).toHaveLength(1);
      expect(page.meta.totalItems).toBe(1);

      const empty = await bodyOf<
        PaginatedResponse<FormalRankCorrectionResponseDto>
      >(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/formal-rank-corrections`)
          .query({ status: FormalRankCorrectionStatus.APPROVED })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(empty.data).toHaveLength(0);
    });
  });

  // ─── Race conditions ───────────────────────────────────────────────────────

  describe('Race conditions', () => {
    it('only one of two concurrent requests for the same assignment succeeds', async () => {
      const { section } = await setupTargetWithFormalRank();

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/formal-rank-corrections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ targetUserId: localUserIdByToken.get(TARGET_TOKEN) }),
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/formal-rank-corrections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ targetUserId: localUserIdByToken.get(TARGET_TOKEN) }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const em = app.get(EntityManager).fork();
      const assignment = await em.findOneOrFail(FormalRankAssignment, {
        user: localUserIdByToken.get(TARGET_TOKEN),
        endedOn: null,
      });
      const activeRequests = await em.find(FormalRankCorrectionRequest, {
        formalRankAssignment: assignment.id,
        status: {
          $in: [
            FormalRankCorrectionStatus.CORRECTION_REQUIRED,
            FormalRankCorrectionStatus.PENDING_APPROVAL,
            FormalRankCorrectionStatus.REJECTED,
          ],
        },
      });
      expect(activeRequests).toHaveLength(1);
    });

    it('only one of a concurrent approve/reject pair succeeds', async () => {
      const { section, rankB } = await setupTargetWithFormalRank();
      const created = (await requestCorrection(
        section.id,
        OWNER_TOKEN,
      )) as FormalRankCorrectionResponseDto;
      await request(app.getHttpServer())
        .post('/api/v1/users/me/formal-rank-correction/submit')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .send({ rankId: rankB.id })
        .expect(201);

      const [approveRes, rejectRes] = await Promise.all([
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/approve`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`),
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/formal-rank-corrections/${created.id}/reject`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({}),
      ]);

      const statuses = [approveRes.status, rejectRes.status].sort();
      // Exactly one succeeds (201); the other finds the request no longer
      // PENDING_APPROVAL (409) - never both succeeding.
      expect(statuses).toEqual([201, 409]);

      const em = app.get(EntityManager).fork();
      const finalRequest = await em.findOneOrFail(FormalRankCorrectionRequest, {
        id: created.id,
      });
      expect([
        FormalRankCorrectionStatus.APPROVED,
        FormalRankCorrectionStatus.REJECTED,
      ]).toContain(finalRequest.status);
    });
  });
});
