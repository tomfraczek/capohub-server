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
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Section } from '../src/groups/entities/section.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const OWNER_TOKEN = 'valid-roleassign-owner-token';
const MEMBER_TOKEN = 'valid-roleassign-member-token';
const SECOND_TOKEN = 'valid-roleassign-second-token';

const OWNER_CLERK_ID = 'user_test_roleassign_owner';
const MEMBER_CLERK_ID = 'user_test_roleassign_member';
const SECOND_CLERK_ID = 'user_test_roleassign_second';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_roleassign_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_roleassign_owner' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_roleassign_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_roleassign_member' },
  },
  [SECOND_TOKEN]: {
    userId: SECOND_CLERK_ID,
    sessionId: 'sess_roleassign_second',
    tokenType: 'session_token',
    claims: { sub: SECOND_CLERK_ID, sid: 'sess_roleassign_second' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-owner.png',
    primaryEmailAddress: { emailAddress: 'roleassign.owner@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-member.png',
    primaryEmailAddress: { emailAddress: 'roleassign.member@example.com' },
  },
  [SECOND_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-second.png',
    primaryEmailAddress: { emailAddress: 'roleassign.second@example.com' },
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

describe('Role Assignments (e2e)', () => {
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
    await cleanup.nativeDelete(RoleAssignment, {
      group: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(Section, { group: { $in: createdGroupIds } });
    await cleanup.nativeDelete(GroupMembership, {
      rootGroup: { $in: createdGroupIds },
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
    await app.close();
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Capoeira Role Assignments',
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

  describe('granting a Role for a Child Group', () => {
    it('grants a Role for the Child Group to a Membership that is active in its Root Group', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Grant Root' });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Grant Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const assignment = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
          .expect(201),
      );

      expect(assignment.groupId).toBe(child.id);
      expect(assignment.membershipId).toBe(membership.id);
      expect(assignment.role).toBe(GroupRole.INSTRUCTOR);

      // The Role now grants direct access to the Child Group.
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${child.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);
    });

    it('rejects granting a Role using a Membership from a different Root Group - 409 ROLE_ROOT_GROUP_MISMATCH', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Mismatch Root' });
      const otherRoot = await createGroup(OWNER_TOKEN, {
        name: 'Mismatch Other Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Mismatch Child',
        parentGroupId: root.id,
      });
      const outsideMembership = await addMember(
        OWNER_TOKEN,
        otherRoot.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            membershipId: outsideMembership.id,
            role: GroupRole.INSTRUCTOR,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_ROOT_GROUP_MISMATCH');
    });

    it('rejects granting a Role to an inactive Membership - 409 ROLE_MEMBERSHIP_NOT_ACTIVE', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Inactive Membership Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Inactive Membership Child',
        parentGroupId: root.id,
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

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_MEMBERSHIP_NOT_ACTIVE');
    });

    it('rejects granting the exact same Role twice for the same (membership, group) pair - 409 ROLE_ASSIGNMENT_ALREADY_EXISTS', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Duplicate Role Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Duplicate Role Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_ASSIGNMENT_ALREADY_EXISTS');
    });

    it('allows a Membership to hold several different Roles for the same Group at once (Jan example: MEMBER + INSTRUCTOR + ADMIN)', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Multi-Role Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Multi-Role Child (Poznan)',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      // Granting INSTRUCTOR (the membership's first Role for this Child
      // Group) automatically grants MEMBER alongside it.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
        .expect(201);
      // Granting ADMIN on top does not replace INSTRUCTOR or MEMBER - all
      // three now coexist.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMembership = roleAssignments
        .filter(
          (roleAssignment) => roleAssignment.membershipId === membership.id,
        )
        .map((roleAssignment) => roleAssignment.role);
      expect(rolesForMembership.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.INSTRUCTOR, GroupRole.ADMIN].sort(),
      );
    });

    it('revoking one Role does not affect the others held for the same Group', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Revoke One Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Revoke One Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const instructorAssignment = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
          .expect(201),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);

      await request(app.getHttpServer())
        .delete(
          `/api/v1/groups/${child.id}/role-assignments/${instructorAssignment.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMembership = roleAssignments
        .filter(
          (roleAssignment) => roleAssignment.membershipId === membership.id,
        )
        .map((roleAssignment) => roleAssignment.role);
      expect(rolesForMembership.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.ADMIN].sort(),
      );
      expect(rolesForMembership).not.toContain(GroupRole.INSTRUCTOR);
    });
  });

  describe('exactly one OWNER per Group', () => {
    it('is enforced at the database level by a partial unique index, independent of the app-level check', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'DB Owner Uniqueness Root',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const em = app.get(EntityManager).fork();

      const secondOwner = new RoleAssignment();
      secondOwner.membership = em.getReference(GroupMembership, membership.id);
      secondOwner.group = em.getReference(Group, root.id);
      secondOwner.role = GroupRole.OWNER;
      secondOwner.grantedAt = new Date();

      const error: unknown = await em
        .persistAndFlush(secondOwner)
        .catch((caught: unknown) => caught);

      expect(error).toBeDefined();
      expect(String((error as Error).message)).toMatch(/unique/i);
    });
  });

  describe('no inheritance', () => {
    it('an ADMIN Role in the Root Group grants no access to a Child Group without its own Role Assignment', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Down Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Down Child',
        parentGroupId: root.id,
      });
      await addMember(OWNER_TOKEN, root.id, MEMBER_TOKEN, GroupRole.ADMIN);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${child.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
    });

    it('a Role granted in a Child Group grants no access to its Root Group', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Up Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Up Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);

      // MEMBER-tier permissions in the Root Group (granted by the
      // Membership's own Root Group Role Assignment, MEMBER) still apply -
      // GROUP_VIEW succeeds - but ADMIN-only capabilities in the Root Group
      // must not: the Child Group ADMIN role has no bearing there.
      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${root.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send(groupPayload({ name: 'Should not apply' }))
        .expect(403);
    });

    it('a Role granted in one Child Group grants no access to a sibling Child Group', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Sibling Root',
      });
      const childA = await createGroup(OWNER_TOKEN, {
        name: 'Sibling A',
        parentGroupId: root.id,
      });
      const childB = await createGroup(OWNER_TOKEN, {
        name: 'Sibling B',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${childA.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);

      // ADMIN in sibling A grants nothing in sibling B - the membership has
      // no Role Assignment at all for sibling B (never granted, and never
      // inherited from sibling A or from the Root Group), so this is a 404
      // exactly like a non-member would get - never a 403, which would
      // reveal that the group exists and that the caller has *some*
      // standing there.
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${childB.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send(groupPayload({ name: 'Should not apply' }))
          .expect(404),
      );
      expect(response.code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('Academy/Section owner-Group verification', () => {
    it('rejects PATCH /groups/:groupId/sections/:sectionId when the section belongs to a different Group - 404 SECTION_NOT_FOUND', async () => {
      const groupA = await createGroup(OWNER_TOKEN, {
        name: 'Owner Verify Group A',
      });
      const groupB = await createGroup(OWNER_TOKEN, {
        name: 'Owner Verify Group B',
      });
      const sectionInA = await createSection(OWNER_TOKEN, groupA.id, 'Kids');

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${groupB.id}/sections/${sectionInA.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Hijacked', description: null })
          .expect(404),
      );
      expect(response.code).toBe('SECTION_NOT_FOUND');

      const stillIntact = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${groupA.id}/sections/${sectionInA.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(stillIntact.name).toBe('Kids');
    });

    it('authorizes Section management in a Child Group via a Role Assignment scoped to that Child Group', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Section Auth Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Section Auth Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/sections`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ name: 'Advanced', description: null })
        .expect(201);
    });
  });

  describe('Role Assignment inactivity after Membership ends', () => {
    it('a Role Assignment grants no effective access once its Membership is removed', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Inactivity Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Inactivity Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${child.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${root.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      // The Role Assignment row still exists (it is never deleted when the
      // Membership ends), but grants no effective access any more - never
      // a fallback, never a stale grant.
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${child.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);

      const em = app.get(EntityManager).fork();
      const stillExists = await em.findOne(RoleAssignment, {
        membership: membership.id,
        group: child.id,
        role: GroupRole.ADMIN,
      });
      expect(stillExists).not.toBeNull();
      expect(stillExists?.role).toBe(GroupRole.ADMIN);
    });
  });

  describe('Role Assignment management', () => {
    it('lists and fetches Role Assignments for a Group', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'List Root' });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'List Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const created = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
          .expect(201),
      );

      const list = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.map((item) => item.id)).toContain(created.id);

      const fetched = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.role).toBe(GroupRole.INSTRUCTOR);
    });

    it('granting an additional Role never "changes" an existing one - both coexist, and there is no PATCH to change one directly', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Change Root' });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Change Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const created = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
          .expect(201),
      );

      // There is no PATCH .../role-assignments/:id - Roles are independent
      // of one another (grantRole/revokeRole only, see ADR-028).
      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${child.id}/role-assignments/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ role: GroupRole.ASSISTANT })
        .expect(404);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ASSISTANT })
        .expect(201);

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMembership = roleAssignments
        .filter(
          (roleAssignment) => roleAssignment.membershipId === membership.id,
        )
        .map((roleAssignment) => roleAssignment.role);
      // INSTRUCTOR is still there, ASSISTANT was added alongside it, and
      // MEMBER is still there too - granting ASSISTANT never replaced
      // INSTRUCTOR.
      expect(rolesForMembership.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.INSTRUCTOR, GroupRole.ASSISTANT].sort(),
      );
    });

    it('revokes a non-owner Role Assignment', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Revoke Root' });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Revoke Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const created = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.INSTRUCTOR })
          .expect(201),
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${child.id}/role-assignments/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${child.id}/role-assignments/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it('forbids a Child Group MEMBER (no MEMBERSHIP_ROLE_CHANGE there) from granting Roles in that Child Group', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Forbid Grant Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Forbid Grant Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const secondMembership = await addMember(
        OWNER_TOKEN,
        root.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );
      // MEMBER_TOKEN holds a Role Assignment for the Child Group itself
      // (plain MEMBER, no MEMBERSHIP_ROLE_CHANGE) - this is what makes the
      // request authorized-but-insufficient (403), as opposed to
      // completely unauthorized for this Group (404).
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.MEMBER })
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ membershipId: secondMembership.id, role: GroupRole.ADMIN })
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });
  });

  describe('MEMBER is the base role of every Group', () => {
    it('automatically grants MEMBER alongside the first Role granted for a Group', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Base Role Root' });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMembership = roleAssignments
        .filter(
          (roleAssignment) => roleAssignment.membershipId === membership.id,
        )
        .map((roleAssignment) => roleAssignment.role);
      expect(rolesForMembership.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.ADMIN].sort(),
      );
    });

    it('rejects revoking MEMBER for a Child Group while another Role is still held there - 409 CANNOT_REMOVE_MEMBER_ROLE', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Guard Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Guard Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: GroupRole.ADMIN })
        .expect(201);
      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const memberRoleAssignment = roleAssignments.find(
        (roleAssignment) =>
          roleAssignment.membershipId === membership.id &&
          roleAssignment.role === GroupRole.MEMBER,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/groups/${child.id}/role-assignments/${memberRoleAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_MEMBER_ROLE');
    });

    it('allows revoking MEMBER for a Child Group once every other Role there has been revoked first - this removes the user from the Child Group', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Leave Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Leave Child',
        parentGroupId: root.id,
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const adminAssignment = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: GroupRole.ADMIN })
          .expect(201),
      );
      const roleAssignmentsBefore = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const memberRoleAssignment = roleAssignmentsBefore.find(
        (roleAssignment) =>
          roleAssignment.membershipId === membership.id &&
          roleAssignment.role === GroupRole.MEMBER,
      );

      // Revoke ADMIN first - MEMBER is still protected while it existed.
      await request(app.getHttpServer())
        .delete(
          `/api/v1/groups/${child.id}/role-assignments/${adminAssignment.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      // Now MEMBER is the only Role left for this Child Group - revoking
      // it is allowed, and removes the user from the Child Group entirely.
      await request(app.getHttpServer())
        .delete(
          `/api/v1/groups/${child.id}/role-assignments/${memberRoleAssignment?.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${child.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
    });

    it("never allows revoking MEMBER for the membership's own Root Group - 409 CANNOT_REMOVE_ROOT_MEMBER_ROLE (use leave/remove instead)", async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Root Guard',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const memberRoleAssignment = roleAssignments.find(
        (roleAssignment) =>
          roleAssignment.membershipId === membership.id &&
          roleAssignment.role === GroupRole.MEMBER,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/groups/${root.id}/role-assignments/${memberRoleAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_ROOT_MEMBER_ROLE');

      // The membership remains completely unaffected - still active, still
      // holding MEMBER for its own Root Group.
      const fetched = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.status).toBe('ACTIVE');
      expect(fetched.rootRoles).toEqual([GroupRole.MEMBER]);
    });
  });
});
