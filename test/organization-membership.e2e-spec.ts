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
import { User } from '../src/users/entities/user.entity';
import { GroupMembershipResponseDto } from '../src/groups/dto/group-membership-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { GroupSummaryResponseDto } from '../src/groups/dto/group-summary-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { MembershipSection } from '../src/groups/entities/membership-section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Section } from '../src/groups/entities/section.entity';
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

describe('Organization Membership (e2e)', () => {
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
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(MembershipSection, {
      membership: {
        rootGroup: { $in: createdGroupIds },
      },
    });
    await cleanup.nativeDelete(Section, { group: { $in: createdGroupIds } });
    await cleanup.nativeDelete(RoleAssignment, {
      group: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(GroupMembership, {
      rootGroup: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(AuditLogEntry, {
      community: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
    await cleanup.nativeDelete(User, {
      clerkUserId: { $in: TEST_CLERK_USER_IDS },
    });
    await app.close();
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
    groupId: string,
    name: string,
  ): Promise<SectionResponseDto> {
    return bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name, description: null })
        .expect(201),
    );
  }

  async function addMember(
    ownerToken: string,
    rootGroupId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<GroupMembershipResponseDto> {
    return bodyOf<GroupMembershipResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${rootGroupId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: localUserIdByToken.get(memberToken), role })
        .expect(201),
    );
  }

  describe('joining an organization', () => {
    it('creates an active membership scoped to the Root Group', async () => {
      const root = await createRootGroup(OWNER_TOKEN, { name: 'Join Org' });

      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      expect(membership.rootGroupId).toBe(root.id);
      expect(membership.status).toBe('ACTIVE');
      expect(membership.sections).toEqual([]);
    });

    it('creates only the Membership when role is omitted - belongs to the organization but not yet assigned to any Group', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Join Org Without Role',
      });

      const membership = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${root.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ userId: localUserIdByToken.get(MEMBER_TOKEN) })
          .expect(201),
      );

      expect(membership.rootGroupId).toBe(root.id);
      expect(membership.status).toBe('ACTIVE');
      expect(membership.rootRoles).toEqual([]);

      // No Role Assignment for the Root Group - not even MEMBER - so
      // accessing it directly is a 404, the same non-enumeration behavior
      // as any other Group with no Role Assignment held there.
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${root.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);

      // But the organization still shows up in "my groups" - Membership
      // alone is enough for that, regardless of holding any Role there.
      const mine = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      const mineEntry = mine.find((item) => item.id === root.id);
      expect(mineEntry?.myRoles).toEqual([]);
    });

    it('rejects a second active membership for the same user in the same Root Group', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'No Duplicate Org',
      });
      await addMember(OWNER_TOKEN, root.id, MEMBER_TOKEN, GroupRole.MEMBER);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/members`)
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

    it('allows the same user to join a different, independent Root Group', async () => {
      const rootA = await createRootGroup(OWNER_TOKEN, { name: 'Org A' });
      const rootB = await createRootGroup(OWNER_TOKEN, { name: 'Org B' });

      await addMember(OWNER_TOKEN, rootA.id, MEMBER_TOKEN, GroupRole.MEMBER);
      const membershipInB = await addMember(
        OWNER_TOKEN,
        rootB.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      expect(membershipInB.rootGroupId).toBe(rootB.id);
    });

    it('rejects creating a membership for a Child Group', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Child Membership Root',
      });
      const child = await createRootGroup(OWNER_TOKEN, {
        name: 'Child Membership Child',
        parentGroupId: root.id,
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/members`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(MEMBER_TOKEN),
          role: GroupRole.MEMBER,
        })
        .expect(400);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_ROOT_GROUP_MISMATCH',
      );
    });
  });

  describe('rootGroupId is immutable', () => {
    it('has no endpoint that accepts rootGroupId at all - PATCH .../members/:membershipId no longer exists (404)', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Immutable Membership Root',
      });
      const otherRoot = await createRootGroup(OWNER_TOKEN, {
        name: 'Immutable Membership Other Root',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      // A Membership may hold several Roles for the same Group at once
      // (see ADR-028), so there is no longer a single "the role" to PATCH
      // on a member - role management always goes through
      // RoleAssignmentsController instead, which has no field for
      // rootGroupId/groupId either (see its own .strict() schemas).
      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${root.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ role: GroupRole.ADMIN, rootGroupId: otherRoot.id })
        .expect(404);

      const fetched = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.rootRoles).toEqual([GroupRole.MEMBER]);
      expect(fetched.rootGroupId).toBe(root.id);
    });
  });

  describe('section assignment', () => {
    it('assigns an active membership to a Section in the same Root Group', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Section Assignment Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, 'Kids');
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${root.id}/members/${membership.id}/sections/${section.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const fetched = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.sections).toEqual([{ id: section.id, name: 'Kids' }]);

      await request(app.getHttpServer())
        .delete(
          `/api/v1/groups/${root.id}/members/${membership.id}/sections/${section.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const afterUnassign = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(afterUnassign.sections).toEqual([]);
    });

    it('rejects assigning a Section that belongs to a different Root Group', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Cross Root Section Root',
      });
      const otherRoot = await createRootGroup(OWNER_TOKEN, {
        name: 'Cross Root Section Other Root',
      });
      const otherSection = await createSection(
        OWNER_TOKEN,
        otherRoot.id,
        'Foreign Section',
      );
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${root.id}/members/${membership.id}/sections/${otherSection.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(400);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_SECTION_MISMATCH',
      );
    });

    it('rejects assigning an archived Section', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Archived Section Root',
      });
      const section = await createSection(
        OWNER_TOKEN,
        root.id,
        'Soon Archived',
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections/${section.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${root.id}/members/${membership.id}/sections/${section.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_SECTION_ARCHIVED',
      );
    });

    it('rejects a duplicate assignment', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Duplicate Section Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, 'Adults');
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${root.id}/members/${membership.id}/sections/${section.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${root.id}/members/${membership.id}/sections/${section.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_SECTION_ALREADY_ASSIGNED',
      );
    });

    it('rejects assigning a section to an inactive membership', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Inactive Membership Section Root',
      });
      const section = await createSection(
        OWNER_TOKEN,
        root.id,
        'Performance Team',
      );
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${root.id}/members/${membership.id}/sections/${section.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      expect((response.body as HttpErrorResponse).code).toBe(
        'MEMBERSHIP_NOT_ACTIVE',
      );
    });
  });

  describe('leaving an organization', () => {
    it('archives the membership, preserves it as history, and blocks it from the active member list', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Leave Org Root',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const activeMembers = await bodyOf<GroupMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(activeMembers.map((member) => member.id)).not.toContain(
        membership.id,
      );

      const history = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(history.status).toBe('ARCHIVED');
      expect(history.endReason).toBe('LEFT');
      expect(history.leftAt).not.toBeNull();
    });

    it('lets a former member rejoin the same Root Group as a brand new membership, without erasing the old one', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Rejoin Org Root',
      });
      const firstMembership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const secondMembership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      expect(secondMembership.id).not.toBe(firstMembership.id);
      expect(secondMembership.status).toBe('ACTIVE');

      const oldRecord = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members/${firstMembership.id}`)
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
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${root.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const history = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members/${membership.id}`)
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
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${root.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${root.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ role: GroupRole.ADMIN })
        .expect(404);
    });

    it('rejects a plain MEMBER from removing another member (insufficient permission)', async () => {
      const root = await createRootGroup(OWNER_TOKEN, {
        name: 'Member Cannot Remove Root',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/groups/${root.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(403);

      expect((response.body as HttpErrorResponse).code).toBe(
        'INSUFFICIENT_GROUP_PERMISSIONS',
      );
    });
  });
});
