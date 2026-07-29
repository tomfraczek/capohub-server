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
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const ADMIN_TOKEN = 'valid-users-admin-token';
const REGULAR_TOKEN = 'valid-users-regular-token';
const CHILD_OWNER_TOKEN = 'valid-users-child-owner-token';
const SECOND_TOKEN = 'valid-users-second-token';

const ADMIN_CLERK_ID = 'user_test_users_admin';
const REGULAR_CLERK_ID = 'user_test_users_regular';
const CHILD_OWNER_CLERK_ID = 'user_test_users_child_owner';
const SECOND_CLERK_ID = 'user_test_users_second';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_users_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_users_admin' },
  },
  [REGULAR_TOKEN]: {
    userId: REGULAR_CLERK_ID,
    sessionId: 'sess_users_regular',
    tokenType: 'session_token',
    claims: { sub: REGULAR_CLERK_ID, sid: 'sess_users_regular' },
  },
  [CHILD_OWNER_TOKEN]: {
    userId: CHILD_OWNER_CLERK_ID,
    sessionId: 'sess_users_child_owner',
    tokenType: 'session_token',
    claims: { sub: CHILD_OWNER_CLERK_ID, sid: 'sess_users_child_owner' },
  },
  [SECOND_TOKEN]: {
    userId: SECOND_CLERK_ID,
    sessionId: 'sess_users_second',
    tokenType: 'session_token',
    claims: { sub: SECOND_CLERK_ID, sid: 'sess_users_second' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [ADMIN_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/users-admin.png',
    primaryEmailAddress: { emailAddress: 'users.admin@example.com' },
  },
  [REGULAR_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/users-regular.png',
    primaryEmailAddress: { emailAddress: 'users.regular@example.com' },
  },
  [CHILD_OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/users-child-owner.png',
    primaryEmailAddress: { emailAddress: 'users.childowner@example.com' },
  },
  [SECOND_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/users-second.png',
    primaryEmailAddress: { emailAddress: 'users.second@example.com' },
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

describe('Users (e2e)', () => {
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
      name: 'Capoeira Delete Account',
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
        .send(groupPayload({ country: 'PL', ...overrides }))
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

  async function grantRole(
    ownerToken: string,
    groupId: string,
    membershipId: string,
    role: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ membershipId, role })
      .expect(201);
  }

  describe('DELETE /users/me - regular user', () => {
    it('deletes the account of a user who is MEMBER/INSTRUCTOR/ADMIN in a Root and a Child Group, without a 500 or FK error, leaving the Groups and their OWNER untouched', async () => {
      const root = await createGroup(ADMIN_TOKEN, {
        name: 'Delete Account Root',
      });
      const child = await createSection(ADMIN_TOKEN, root.id, {
        name: 'Delete Account Child',
      });
      const membership = await addMember(
        ADMIN_TOKEN,
        root.id,
        REGULAR_TOKEN,
        GroupRole.MEMBER,
      );
      await grantRole(
        ADMIN_TOKEN,
        child.id,
        membership.id,
        GroupRole.INSTRUCTOR,
      );
      await grantRole(ADMIN_TOKEN, child.id, membership.id, GroupRole.ADMIN);

      const regularUserId = localUserIdByToken.get(REGULAR_TOKEN) as string;

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${REGULAR_TOKEN}`)
        .expect(204);

      const em = app.get(EntityManager).fork();

      // The local User row is gone.
      const survivingUser = await em.findOne(User, { id: regularUserId });
      expect(survivingUser).toBeNull();

      // Every Membership of theirs is gone.
      const survivingMemberships = await em.count(GroupMembership, {
        user: regularUserId,
      });
      expect(survivingMemberships).toBe(0);

      // Every RoleAssignment tied to that (now-deleted) Membership is gone.
      const survivingRoleAssignments = await em.count(RoleAssignment, {
        membership: membership.id,
      });
      expect(survivingRoleAssignments).toBe(0);

      // The Groups themselves survive, along with their OWNER - completely
      // unaffected by another member's account deletion.
      const rootStillExists = await em.findOne(Group, { id: root.id });
      const childStillExists = await em.findOne(Group, { id: child.id });
      expect(rootStillExists).not.toBeNull();
      expect(childStillExists).not.toBeNull();

      const rootOwners = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/role-assignments`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      expect(
        rootOwners.filter((ra) => ra.role === GroupRole.OWNER),
      ).toHaveLength(1);

      const childOwners = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      expect(
        childOwners.filter((ra) => ra.role === GroupRole.OWNER),
      ).toHaveLength(1);
    });

    it('allows a user with a Membership but no RoleAssignment at all to delete the account', async () => {
      const root = await createGroup(ADMIN_TOKEN, {
        name: 'Delete Account Bare Membership Root',
      });

      // addMember with no `role` creates only the Membership itself - no
      // Role Assignment, not even MEMBER (see ADR-028/ADR-004).
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/members`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ userId: localUserIdByToken.get(SECOND_TOKEN) })
        .expect(201);

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(204);

      const em = app.get(EntityManager).fork();
      const survivingUser = await em.findOne(User, {
        clerkUserId: SECOND_CLERK_ID,
      });
      expect(survivingUser).toBeNull();
    });
  });

  describe('DELETE /users/me - OWNER', () => {
    it('blocks deleting the account while the user owns a Child Group, and allows it once ownership has been transferred - the Child Group keeps exactly one OWNER throughout', async () => {
      const root = await createGroup(ADMIN_TOKEN, {
        name: 'Delete Account Owner Root',
      });
      const child = await createSection(ADMIN_TOKEN, root.id, {
        name: 'Delete Account Owner Child',
      });
      await addMember(
        ADMIN_TOKEN,
        root.id,
        CHILD_OWNER_TOKEN,
        GroupRole.MEMBER,
      );

      // Hand the Child Group's ownership to CHILD_OWNER_TOKEN.
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${child.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(CHILD_OWNER_TOKEN) })
        .expect(201);

      const blocked = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete('/api/v1/users/me')
          .set('Authorization', `Bearer ${CHILD_OWNER_TOKEN}`)
          .expect(409),
      );
      expect(blocked.code).toBe('CANNOT_DELETE_ACCOUNT_OWNS_GROUPS');

      // The account must still exist - the block happened before any
      // deletion took place.
      const stillThere = await bodyOf<{ id: string }>(
        request(app.getHttpServer())
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${CHILD_OWNER_TOKEN}`)
          .expect(200),
      );
      expect(stillThere.id).toBe(localUserIdByToken.get(CHILD_OWNER_TOKEN));

      // Transfer the Child Group's ownership away, back to ADMIN_TOKEN.
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${child.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${CHILD_OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(ADMIN_TOKEN) })
        .expect(201);

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${CHILD_OWNER_TOKEN}`)
        .expect(204);

      const em = app.get(EntityManager).fork();
      const survivingUser = await em.findOne(User, {
        clerkUserId: CHILD_OWNER_CLERK_ID,
      });
      expect(survivingUser).toBeNull();

      const childOwners = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      expect(
        childOwners.filter((ra) => ra.role === GroupRole.OWNER),
      ).toHaveLength(1);
    });
  });
});
