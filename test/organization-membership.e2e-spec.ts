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
import { SectionMembershipResponseDto } from '../src/groups/dto/section-membership-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { GroupSummaryResponseDto } from '../src/groups/dto/group-summary-response.dto';
import { CohortResponseDto } from '../src/groups/dto/cohort-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { MembershipCohort } from '../src/groups/entities/membership-cohort.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Cohort } from '../src/groups/entities/cohort.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const OWNER_TOKEN = 'valid-orgmem-owner-token';
const MEMBER_TOKEN = 'valid-orgmem-member-token';
const OUTSIDER_TOKEN = 'valid-orgmem-outsider-token';

const OWNER_CLERK_ID = 'user_test_orgmem_owner';
const MEMBER_CLERK_ID = 'user_test_orgmem_member';
const OUTSIDER_CLERK_ID = 'user_test_orgmem_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_orgmem_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_orgmem_owner' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_orgmem_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_orgmem_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_orgmem_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_orgmem_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/orgmem-owner.png',
    primaryEmailAddress: { emailAddress: 'orgmem.owner@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/orgmem-member.png',
    primaryEmailAddress: { emailAddress: 'orgmem.member@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/orgmem-outsider.png',
    primaryEmailAddress: { emailAddress: 'orgmem.outsider@example.com' },
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

// Section is the only entity with real membership under the
// Membership/RoleAssignments rebuild - a Group has none at all (only
// OWNER/ADMIN via direct grant/transfer). Every scenario below that used
// to exercise `/groups/:id/members`/`/groups/:id/leave` directly now
// creates a Section under the Group first and targets that instead.
describe('Section Membership (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const createdSectionIds: string[] = [];
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

    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/groups')
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
      const allTargetIds = [...createdGroupIds, ...createdSectionIds];
      await cleanup.nativeDelete(MembershipCohort, {
        membership: {
          section: { $in: createdSectionIds },
        },
      });
      await cleanup.nativeDelete(Cohort, {
        $or: [
          { group: { $in: allTargetIds } },
          { section: { $in: allTargetIds } },
        ],
      });
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: allTargetIds } },
          { section: { $in: allTargetIds } },
        ],
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: createdSectionIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: allTargetIds } },
          { section: { $in: allTargetIds } },
        ],
      });
      // Sections must be removed before their parent Groups to satisfy the
      // parent_group_id foreign key (no cascade - see section.entity.ts).
      await cleanup.nativeDelete(Section, { id: { $in: createdSectionIds } });
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
      name: 'Capoeira Brasil',
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

  async function createRootGroup(
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
    const res = await request(app.getHttpServer())
      .post(`/api/v1/groups/${parentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Section',
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
      });
    if (res.status !== 201) {
      console.error(
        'DIAG createSection failed',
        'status=',
        res.status,
        'body=',
        JSON.stringify(res.body),
        'parentId=',
        parentId,
      );
    }
    expect(res.status).toBe(201);
    const created = res.body as SectionResponseDto;
    createdSectionIds.push(created.id);
    return created;
  }

  async function createCohort(
    token: string,
    groupId: string,
    name: string,
  ): Promise<CohortResponseDto> {
    return bodyOf<CohortResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/cohorts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name, description: null })
        .expect(201),
    );
  }

  async function addSectionMember(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
    role?: GroupRole,
  ): Promise<SectionMembershipResponseDto> {
    return bodyOf<SectionMembershipResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: localUserIdByToken.get(memberToken), role })
        .expect(201),
    );
  }

  describe('joining a Section', () => {
    it('creates an active membership scoped to the Section, atomically carrying MEMBER', async () => {
      const root = await createRootGroup(OWNER_TOKEN, { name: 'Join Org' });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Join Section',
      });

      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      expect(membership.sectionId).toBe(section.id);
      expect(membership.status).toBe('ACTIVE');
      expect(membership.roles).toEqual([GroupRole.MEMBER]);
      expect(membership.cohorts).toEqual([]);
    });

    it('never creates a roleless membership - MEMBER is always granted atomically, even with no additional role requested', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Join Org Always MEMBER',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Join Section Always MEMBER',
      });

      const membership = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ userId: localUserIdByToken.get(MEMBER_TOKEN) })
          .expect(201),
      );

      expect(membership.sectionId).toBe(section.id);
      expect(membership.status).toBe('ACTIVE');
      expect(membership.roles).toEqual([GroupRole.MEMBER]);

      // The Section itself shows up in "my groups" only via a held Role
      // Assignment on the *Group* - joining a Section grants nothing on
      // its parent Group at all (no inheritance either direction).
      const mine = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(mine.some((item) => item.id === root.id)).toBe(false);
    });

    it('rejects a second active membership for the same user in the same Section', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'No Duplicate Org',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'No Duplicate Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(MEMBER_TOKEN),
          role: GroupRole.ADMIN,
        })
        .expect(409);

      expect((response.body as HttpErrorResponse).code).toBe(
        'ALREADY_A_MEMBER',
      );
    });

    it('allows the same user to join a different, independent Section', async () => {
      const root = await createRootGroup(OWNER_TOKEN, { name: 'Org A/B' });
      const sectionA = await createSection(OWNER_TOKEN, root.id, {
        name: 'Section A',
      });
      const sectionB = await createSection(OWNER_TOKEN, root.id, {
        name: 'Section B',
      });

      await addSectionMember(OWNER_TOKEN, sectionA.id, MEMBER_TOKEN);
      const membershipInB = await addSectionMember(
        OWNER_TOKEN,
        sectionB.id,
        MEMBER_TOKEN,
      );

      expect(membershipInB.sectionId).toBe(sectionB.id);
    });

    it('rejects adding a member directly on a Group - the endpoint does not exist at all (404)', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'No Group Members Root',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/members`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(MEMBER_TOKEN),
          role: GroupRole.MEMBER,
        })
        .expect(404);
    });
  });

  describe('sectionId is immutable', () => {
    it('has no endpoint that accepts sectionId at all - PATCH .../members/:membershipId does not exist (404)', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Immutable Membership Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Immutable Membership Section',
      });
      const otherSection = await createSection(OWNER_TOKEN, root.id, {
        name: 'Immutable Membership Other Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      // A membership may hold several Roles for the same Section at once,
      // so there is no longer a single "the role" to PATCH on a member -
      // role management always goes through RoleAssignmentsController
      // instead, which has no field for sectionId/groupId either (see its
      // own .strict() schemas).
      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ role: GroupRole.ADMIN, sectionId: otherSection.id })
        .expect(404);

      const fetched = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.roles).toEqual([GroupRole.MEMBER]);
      expect(fetched.sectionId).toBe(section.id);
    });
  });

  describe('cohort assignment', () => {
    it('assigns an active membership to a Cohort in the same organization tree', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Cohort Assignment Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Cohort Assignment Section',
      });
      const cohort = await createCohort(OWNER_TOKEN, root.id, 'Kids');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/members/${membership.id}/cohorts/${cohort.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const fetched = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.cohorts).toEqual([{ id: cohort.id, name: 'Kids' }]);

      await request(app.getHttpServer())
        .delete(
          `/api/v1/sections/${section.id}/members/${membership.id}/cohorts/${cohort.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const afterUnassign = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(afterUnassign.cohorts).toEqual([]);
    });

    it('rejects assigning a Cohort that belongs to a different organization tree', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Cross Root Cohort Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Cross Root Cohort Section',
      });
      const otherRoot = await createRootGroup(OWNER_TOKEN, {
        name: 'Cross Root Cohort Other Root',
      });
      const otherCohort = await createCohort(
        OWNER_TOKEN,
        otherRoot.id,
        'Foreign Cohort',
      );
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/members/${membership.id}/cohorts/${otherCohort.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(400);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_COHORT_MISMATCH',
      );
    });

    it('rejects assigning an archived Cohort', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Archived Cohort Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Archived Cohort Section',
      });
      const cohort = await createCohort(OWNER_TOKEN, root.id, 'Soon Archived');
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/cohorts/${cohort.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/members/${membership.id}/cohorts/${cohort.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_COHORT_ARCHIVED',
      );
    });

    it('rejects a duplicate assignment', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Duplicate Cohort Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Duplicate Cohort Section',
      });
      const cohort = await createCohort(OWNER_TOKEN, root.id, 'Adults');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/members/${membership.id}/cohorts/${cohort.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/members/${membership.id}/cohorts/${cohort.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_COHORT_ALREADY_ASSIGNED',
      );
    });

    it('rejects assigning a cohort to an inactive membership', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Inactive Membership Cohort Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Inactive Membership Cohort Section',
      });
      const cohort = await createCohort(
        OWNER_TOKEN,
        root.id,
        'Performance Team',
      );
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/members/${membership.id}/cohorts/${cohort.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_NOT_ACTIVE',
      );
    });
  });

  describe('leaving a Section', () => {
    it('archives the membership, preserves it as history, revokes MEMBER, and blocks it from the active member list', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Leave Org Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Leave Org Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const activeMembers = await bodyOf<SectionMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(activeMembers.map((member) => member.id)).not.toContain(
        membership.id,
      );

      const history = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(history.status).toBe('ARCHIVED');
      expect(history.endReason).toBe('LEFT');
      expect(history.leftAt).not.toBeNull();
      expect(history.roles).toEqual([]);
    });

    it('lets a former member rejoin the same Section as a brand new membership, without erasing the old one, and without reactivating any historical Role', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Rejoin Org Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Rejoin Org Section',
      });
      const firstMembership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const secondMembership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      expect(secondMembership.id).not.toBe(firstMembership.id);
      expect(secondMembership.status).toBe('ACTIVE');
      // Only the freshly-granted MEMBER - the historical ADMIN from the
      // first stint is not reactivated (see revokedAt-based stint
      // disambiguation in role-assignment.entity.ts).
      expect(secondMembership.roles).toEqual([GroupRole.MEMBER]);

      const oldRecord = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members/${firstMembership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(oldRecord.status).toBe('ARCHIVED');
    });
  });

  describe('removal by an administrator', () => {
    it('archives the membership with endReason REMOVED, distinct from a self-service leave', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Admin Removal Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Admin Removal Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const history = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(history.status).toBe('ARCHIVED');
      expect(history.endReason).toBe('REMOVED');
    });
  });

  describe('authorization', () => {
    it("rejects a non-member from managing someone else's membership", async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Authorization Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Authorization Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ role: GroupRole.ADMIN })
        .expect(404);
    });

    it('rejects a plain MEMBER from removing another member (insufficient permission)', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Member Cannot Remove Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Member Cannot Remove Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(403);

      expect((response.body as HttpErrorResponse).code).toBe(
        'INSUFFICIENT_GROUP_PERMISSIONS',
      );
    });
  });
});
