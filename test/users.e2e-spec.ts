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
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

// No fixed "ADMIN_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user, and this file needs a fresh Group
// (+ Section) owner in each of the three "DELETE /users/me" tests below, so
// createGroup() mints one via createFreshGroupOwner per call instead.
const REGULAR_TOKEN = 'valid-users-regular-token';
const CHILD_OWNER_TOKEN = 'valid-users-child-owner-token';
const SECOND_TOKEN = 'valid-users-second-token';

const REGULAR_CLERK_ID = 'user_test_users_regular';
const CHILD_OWNER_CLERK_ID = 'user_test_users_child_owner';
const SECOND_CLERK_ID = 'user_test_users_second';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
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
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      // Sections must be removed before their parent Groups to satisfy the
      // parent_group_id foreign key (no cascade - see section.entity.ts).
      await cleanup.nativeDelete(Section, { id: { $in: createdGroupIds } });
      // Child Groups must be nulled before their parents to satisfy the
      // parent_group_id self-FK (no cascade - see group.entity.ts).
      await cleanup.nativeUpdate(
        Group,
        { id: { $in: createdGroupIds } },
        { parentGroup: null },
      );
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below (see
      // user-profile.e2e-spec.ts's identical cleanup step).
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // Must be read fresh here (not a stale snapshot taken at module load)
      // since createGroup (via createFreshGroupOwner) registers a fresh
      // fixture user per call, mutating FIXTURE_CLERK_PROFILES in place.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
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
      ...overrides,
    };
  }

  async function createGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto & { token: string; userId: string }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'users',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
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
        })
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  // Joining a Section always grants MEMBER atomically - `role`, if given,
  // grants that additional Role alongside MEMBER in the same call (see
  // SectionMembershipsService.addMember). There is no Section-membership
  // equivalent for Group - Group has no members at all.
  async function joinSection(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
    role?: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function grantGroupRole(
    ownerToken: string,
    groupId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
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

  async function transferSectionOwnership(
    ownerToken: string,
    sectionId: string,
    newOwnerToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/transfer-ownership`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ newOwnerUserId: localUserIdByToken.get(newOwnerToken) })
      .expect(201);
  }

  describe('DELETE /users/me - regular user', () => {
    it('deletes the account of a user who holds ADMIN on a Group and MEMBER/INSTRUCTOR/ADMIN on a Section under it, without a 500 or FK error, leaving the Group/Section and their OWNER untouched', async () => {
      const root = await createGroup({
        name: 'Delete Account Root',
      });
      const child = await createSection(root.token, root.id, {
        name: 'Delete Account Child',
      });
      await grantGroupRole(root.token, root.id, REGULAR_TOKEN, GroupRole.ADMIN);
      await joinSection(root.token, child.id, REGULAR_TOKEN);
      await grantSectionRole(
        root.token,
        child.id,
        REGULAR_TOKEN,
        GroupRole.INSTRUCTOR,
      );
      await grantSectionRole(
        root.token,
        child.id,
        REGULAR_TOKEN,
        GroupRole.ADMIN,
      );

      const regularUserId = localUserIdByToken.get(REGULAR_TOKEN) as string;

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${REGULAR_TOKEN}`)
        .expect(204);

      const em = app.get(EntityManager).fork();

      // The local User row is gone.
      const survivingUser = await em.findOne(User, { id: regularUserId });
      expect(survivingUser).toBeNull();

      // Every SectionMembership of theirs is gone.
      const survivingMemberships = await em.count(SectionMembership, {
        user: regularUserId,
      });
      expect(survivingMemberships).toBe(0);

      // Every RoleAssignment they held (Group and Section) is gone.
      const survivingRoleAssignments = await em.count(RoleAssignment, {
        user: regularUserId,
      });
      expect(survivingRoleAssignments).toBe(0);

      // The Groups themselves survive, along with their OWNER - completely
      // unaffected by another member's account deletion.
      const rootStillExists = await em.findOne(Group, { id: root.id });
      const childStillExists = await em.findOne(Section, { id: child.id });
      expect(rootStillExists).not.toBeNull();
      expect(childStillExists).not.toBeNull();

      const rootOwners = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(
        rootOwners.filter((ra) => ra.role === GroupRole.OWNER),
      ).toHaveLength(1);

      const childOwners = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(
        childOwners.filter((ra) => ra.role === GroupRole.OWNER),
      ).toHaveLength(1);
    });

    it('allows a user with only the base MEMBER role (no additional role) to delete the account', async () => {
      const root = await createGroup({
        name: 'Delete Account Bare Membership Root',
      });
      const child = await createSection(root.token, root.id, {
        name: 'Delete Account Bare Membership Section',
      });

      // Joining with no additional `role` still atomically grants MEMBER -
      // there is no "membership with zero roles" under the new model (see
      // SectionMembershipsService.addMember).
      await joinSection(root.token, child.id, SECOND_TOKEN);

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
    it('blocks deleting the account while the user owns a Section, and allows it once ownership has been transferred - the Section keeps exactly one OWNER throughout', async () => {
      const root = await createGroup({
        name: 'Delete Account Owner Root',
      });
      // transferSectionOwnership resolves its newOwnerToken argument through
      // this map, which createFreshGroupOwner (unlike beforeAll) does not
      // populate - root.token is only transferred BACK to below, so it must
      // be registered here first.
      localUserIdByToken.set(root.token, root.userId);
      const child = await createSection(root.token, root.id, {
        name: 'Delete Account Owner Child',
      });
      // Must be an ACTIVE Section member before ownership can be
      // transferred to them (see RoleAssignmentsService.transferOwnership).
      await joinSection(root.token, child.id, CHILD_OWNER_TOKEN);

      await transferSectionOwnership(root.token, child.id, CHILD_OWNER_TOKEN);

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

      // Transfer the Section's ownership away, back to root.token - who is
      // already an ACTIVE member of it (the creator, from createSection
      // above).
      await transferSectionOwnership(CHILD_OWNER_TOKEN, child.id, root.token);

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
          .get(`/api/v1/sections/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(
        childOwners.filter((ra) => ra.role === GroupRole.OWNER),
      ).toHaveLength(1);
    });
  });
});
