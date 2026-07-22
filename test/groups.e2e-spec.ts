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
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { TransferOwnershipResponseDto } from '../src/groups/dto/transfer-ownership-response.dto';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const OWNER_TOKEN = 'valid-groups-owner-token';
const SECOND_TOKEN = 'valid-groups-second-token';
const THIRD_TOKEN = 'valid-groups-third-token';
const OUTSIDER_TOKEN = 'valid-groups-outsider-token';

const OWNER_CLERK_ID = 'user_test_groups_owner';
const SECOND_CLERK_ID = 'user_test_groups_second';
const THIRD_CLERK_ID = 'user_test_groups_third';
const OUTSIDER_CLERK_ID = 'user_test_groups_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_groups_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_groups_owner' },
  },
  [SECOND_TOKEN]: {
    userId: SECOND_CLERK_ID,
    sessionId: 'sess_groups_second',
    tokenType: 'session_token',
    claims: { sub: SECOND_CLERK_ID, sid: 'sess_groups_second' },
  },
  [THIRD_TOKEN]: {
    userId: THIRD_CLERK_ID,
    sessionId: 'sess_groups_third',
    tokenType: 'session_token',
    claims: { sub: THIRD_CLERK_ID, sid: 'sess_groups_third' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_groups_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_groups_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/groups-owner.png',
    primaryEmailAddress: { emailAddress: 'groups.owner@example.com' },
  },
  [SECOND_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/groups-second.png',
    primaryEmailAddress: { emailAddress: 'groups.second@example.com' },
  },
  [THIRD_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/groups-third.png',
    primaryEmailAddress: { emailAddress: 'groups.third@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/groups-outsider.png',
    primaryEmailAddress: { emailAddress: 'groups.outsider@example.com' },
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

describe('Groups (e2e)', () => {
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
      name: 'Grupo Axé Capoeira',
      description: 'A local capoeira group',
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: 'contact@example.com',
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
    groupId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<GroupMembershipResponseDto> {
    return bodyOf<GroupMembershipResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: localUserIdByToken.get(memberToken), role })
        .expect(201),
    );
  }

  async function archiveGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  async function setReadOnlyGroup(
    token: string,
    groupId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/read-only`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  async function activateGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  describe('create', () => {
    it('creates a group and automatically makes the creator OWNER', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Nova Geração' });

      expect(created.name).toBe('Nova Geração');
      expect(created.status).toBe('ACTIVE');

      const members = await bodyOf<GroupMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(members).toHaveLength(1);
      // The creator automatically holds MEMBER (granted the instant they
      // are added to any Group) alongside OWNER - not OWNER alone (see
      // ADR-028: a Membership may hold several Roles for the same Group).
      expect(members[0].rootRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, GroupRole.OWNER]),
      );
      expect(members[0].user.id).toBe(localUserIdByToken.get(OWNER_TOKEN));
    });

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/groups')
        .send(groupPayload())
        .expect(401);
    });
  });

  describe('listMine', () => {
    it('lists only groups the caller actively belongs to', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Only Mine' });

      const list = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(list.map((item) => item.id)).toContain(created.id);
      expect(list.find((item) => item.id === created.id)?.myRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, GroupRole.OWNER]),
      );
    });
  });

  describe('getById', () => {
    it('returns 404 for a user with no active membership', async () => {
      const created = await createGroup(OWNER_TOKEN);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('returns 404 for a non-existent group id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/groups/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it('returns group details for an active member', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(details.id).toBe(created.id);
    });
  });

  describe('update', () => {
    it('allows the owner to edit the group', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(groupPayload({ name: 'Renamed Group' }))
          .expect(200),
      );

      expect(updated.name).toBe('Renamed Group');
    });

    it('forbids a plain member from editing the group', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send(groupPayload({ name: 'Hijacked' }))
        .expect(403);
    });
  });

  describe('archive', () => {
    it('allows the owner to archive the group', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const archived = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );

      expect(archived.status).toBe('ARCHIVED');
    });

    it('forbids an admin from archiving the group', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.ADMIN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });
  });

  describe('members', () => {
    it('adds a member with the given role', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      // Joining always grants MEMBER automatically, alongside the
      // requested Role (see ADR-028) - not instead of it.
      expect(membership.rootRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, GroupRole.INSTRUCTOR]),
      );
      expect(membership.user.id).toBe(localUserIdByToken.get(SECOND_TOKEN));
    });

    it('rejects adding the same user twice with 409 ALREADY_A_MEMBER', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: GroupRole.MEMBER,
          })
          .expect(409),
      );
      expect(response.code).toBe('ALREADY_A_MEMBER');
    });

    it('forbids a plain member from adding another member', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send({ userId: localUserIdByToken.get(THIRD_TOKEN), role: 'MEMBER' })
        .expect(403);
    });

    it('grants an additional Role to a non-owner member via role-assignments, alongside the automatic MEMBER Role', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: membership.id, role: 'ADMIN' })
        .expect(201);

      const updated = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(updated.rootRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, 'ADMIN']),
      );
    });

    it('no longer exposes PATCH .../members/:membershipId to change a role - 404', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${created.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ role: 'ADMIN' })
        .expect(404);
    });

    it('removes a non-owner member', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${created.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const members = await bodyOf<GroupMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(members.map((m) => m.id)).not.toContain(membership.id);
    });

    it('cannot remove the owner - 409 CANNOT_REMOVE_OWNER', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const members = await bodyOf<GroupMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const ownerMembership = members[0];

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${created.id}/members/${ownerMembership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_OWNER');
    });

    it('cannot revoke the OWNER Role Assignment directly via role-assignments - 409 CANNOT_REMOVE_OWNER, and there is no PATCH to change it instead', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const members = await bodyOf<GroupMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const ownerMembership = members[0];
      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const ownerRoleAssignment = roleAssignments.find(
        (roleAssignment) =>
          roleAssignment.membershipId === ownerMembership.id &&
          roleAssignment.role === GroupRole.OWNER,
      );

      // There is no PATCH .../role-assignments/:id at all - grantRole and
      // revokeRole are the only two mutations (see ADR-028).
      await request(app.getHttpServer())
        .patch(
          `/api/v1/groups/${created.id}/role-assignments/${ownerRoleAssignment?.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ role: 'ADMIN' })
        .expect(404);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/groups/${created.id}/role-assignments/${ownerRoleAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_OWNER');
    });
  });

  describe('unique active membership', () => {
    it('allows re-adding a user after they left (historical membership preserved)', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const first = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/leave`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(204);

      const second = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.ADMIN,
      );

      expect(second.id).not.toBe(first.id);
      expect(second.rootRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, GroupRole.ADMIN]),
      );
    });

    it('allows re-adding a user after they were removed (historical membership preserved)', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const first = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${created.id}/members/${first.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const second = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      expect(second.id).not.toBe(first.id);
      expect(second.rootRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, GroupRole.INSTRUCTOR]),
      );
    });

    it('rejects a duplicate active membership via the API with 409 ALREADY_A_MEMBER', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: GroupRole.MEMBER,
          })
          .expect(409),
      );
      expect(response.code).toBe('ALREADY_A_MEMBER');
    });

    it('is enforced at the database level by a partial unique index, independent of the app-level check', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const em = app.get(EntityManager).fork();
      const userId = localUserIdByToken.get(SECOND_TOKEN);

      const first = new GroupMembership();
      first.rootGroup = em.getReference(Group, created.id);
      first.user = em.getReference(User, userId as string);
      first.joinedAt = new Date();
      await em.persistAndFlush(first);

      const second = new GroupMembership();
      second.rootGroup = em.getReference(Group, created.id);
      second.user = em.getReference(User, userId as string);
      second.joinedAt = new Date();

      const error: unknown = await em
        .persistAndFlush(second)
        .catch((caught: unknown) => caught);

      expect(error).toBeDefined();
      expect(String((error as Error).message)).toMatch(/unique/i);
    });
  });

  describe('leave', () => {
    it('allows a non-owner member to leave', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/leave`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(404);
    });

    it('blocks the owner from leaving - 409 OWNER_MUST_TRANSFER_OWNERSHIP', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/leave`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('OWNER_MUST_TRANSFER_OWNERSHIP');
    });
  });

  describe('transferOwnership', () => {
    it('transfers ownership atomically: the previous owner loses only OWNER, every other Role is untouched', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const previousOwnerMembership = (
        await bodyOf<GroupMembershipResponseDto[]>(
          request(app.getHttpServer())
            .get(`/api/v1/groups/${created.id}/members`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(200),
        )
      )[0];
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      const result = await bodyOf<TransferOwnershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN),
          })
          .expect(201),
      );

      // The new owner keeps the MEMBER Role granted automatically when
      // they joined, plus the new OWNER Role - not OWNER alone.
      expect(result.newOwner.rootRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, GroupRole.OWNER]),
      );
      // The previous owner loses *only* OWNER - MEMBER (their only other
      // Role here) is completely untouched.
      expect(result.previousOwner.rootRoles).toEqual([GroupRole.MEMBER]);
      expect(result.previousOwner.id).toBe(previousOwnerMembership.id);

      // The old owner (now plain MEMBER) can no longer archive; only the
      // new owner can.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(403);

      const archived = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(201),
      );
      expect(archived.status).toBe('ARCHIVED');
    });

    it('preserves the previous owner’s other Roles (e.g. ADMIN) across the transfer - not just MEMBER', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const previousOwnerMembership = (
        await bodyOf<GroupMembershipResponseDto[]>(
          request(app.getHttpServer())
            .get(`/api/v1/groups/${created.id}/members`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(200),
        )
      )[0];
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ membershipId: previousOwnerMembership.id, role: 'ADMIN' })
        .expect(201);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      const result = await bodyOf<TransferOwnershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
          .expect(201),
      );

      expect(result.previousOwner.rootRoles).toEqual(
        expect.arrayContaining([GroupRole.MEMBER, GroupRole.ADMIN]),
      );
      expect(result.previousOwner.rootRoles).not.toEqual(
        expect.arrayContaining([GroupRole.OWNER]),
      );
    });

    it('rejects a smuggled previousOwnerRole field with 400 VALIDATION_ERROR - the previous owner keeps their existing Roles, none are chosen for them', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN),
            previousOwnerRole: 'ADMIN',
          })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('rejects transfer attempted by a non-owner admin with 403', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.ADMIN);
      await addMember(OWNER_TOKEN, created.id, THIRD_TOKEN, GroupRole.MEMBER);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send({
          newOwnerUserId: localUserIdByToken.get(THIRD_TOKEN),
        })
        .expect(403);
    });

    it('rejects transferring to a user with no active membership - 400 TARGET_NOT_A_MEMBER', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(OUTSIDER_TOKEN),
          })
          .expect(400),
      );
      expect(response.code).toBe('TARGET_NOT_A_MEMBER');
    });
  });

  describe('Child Group ownership (e2e)', () => {
    it("blocks leaving the Organization while owning a Child Group, and allows it once that Child Group's ownership is transferred - the Child Group keeps exactly one OWNER throughout", async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Child Ownership Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Child Ownership Child',
        parentGroupId: root.id,
      });
      await addMember(OWNER_TOKEN, root.id, SECOND_TOKEN, GroupRole.MEMBER);

      // OWNER_TOKEN hands off the Root Group itself to SECOND_TOKEN, so
      // OWNER_TOKEN becomes a plain member of the Organization - but still
      // owns the Child Group created above.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
        .expect(201);

      // Still blocked: not the Root Group's OWNER anymore, but still the
      // Child Group's OWNER - this is exactly the gap being fixed here.
      const blocked = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${root.id}/leave`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(blocked.code).toBe('OWNER_MUST_TRANSFER_OWNERSHIP');

      // Transfer the Child Group's ownership too - directly at the Child
      // Group's own transfer-ownership endpoint.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
        .expect(201);

      // Now leaving succeeds.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/leave`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      // The Child Group still has exactly one OWNER - SECOND_TOKEN.
      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(200),
      );
      const owners = roleAssignments.filter(
        (roleAssignment) => roleAssignment.role === GroupRole.OWNER,
      );
      expect(owners).toHaveLength(1);
    });

    it('blocks leaving while owning multiple Child Groups - only succeeds once every one of them has been transferred', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Multi Child Root' });
      const childA = await createGroup(OWNER_TOKEN, {
        name: 'Multi Child A',
        parentGroupId: root.id,
      });
      const childB = await createGroup(OWNER_TOKEN, {
        name: 'Multi Child B',
        parentGroupId: root.id,
      });
      await addMember(OWNER_TOKEN, root.id, SECOND_TOKEN, GroupRole.MEMBER);
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
        .expect(201);

      // Owns both Child Groups - blocked.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/leave`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      // Transfer only one Child Group - still blocked by the other.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${childA.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
        .expect(201);

      const stillBlocked = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${root.id}/leave`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(stillBlocked.code).toBe('OWNER_MUST_TRANSFER_OWNERSHIP');

      // Transfer the second Child Group too - leaving now succeeds.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${childB.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/leave`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });

    it('blocks an administrator from removing a member who owns a Child Group, and allows it once ownership is transferred', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Remove Owner Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Remove Owner Child',
        parentGroupId: root.id,
      });
      const thirdMembership = await addMember(
        OWNER_TOKEN,
        root.id,
        THIRD_TOKEN,
        GroupRole.MEMBER,
      );

      // Hand the Child Group's ownership to THIRD_TOKEN - OWNER_TOKEN
      // remains the Root Group's OWNER throughout, exercising removeMember
      // (an administrative action) rather than leave (self-service).
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(THIRD_TOKEN) })
        .expect(201);

      const blocked = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${root.id}/members/${thirdMembership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(blocked.code).toBe('CANNOT_REMOVE_OWNER');

      // THIRD_TOKEN (the Child Group's current OWNER) transfers it back.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${THIRD_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(OWNER_TOKEN) })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${root.id}/members/${thirdMembership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const owners = roleAssignments.filter(
        (roleAssignment) => roleAssignment.role === GroupRole.OWNER,
      );
      expect(owners).toHaveLength(1);
    });

    it('still allows the Root Group OWNER to leave once they own nothing at all - no regression for the Root-only case', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Root Only Regression',
      });
      await addMember(OWNER_TOKEN, root.id, SECOND_TOKEN, GroupRole.MEMBER);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/leave`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });
  });

  describe('archived group (writes blocked)', () => {
    it('still allows active members to read group details, member list, and see it in "my groups"', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await archiveGroup(OWNER_TOKEN, created.id);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(200),
      );
      expect(details.status).toBe('ARCHIVED');

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}/members`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(200);

      const mine = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(mine.find((item) => item.id === created.id)?.status).toBe(
        'ARCHIVED',
      );
    });

    it('blocks PATCH /groups/:id with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(groupPayload({ name: 'Should not apply' }))
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks re-archiving an already-archived group with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks POST /groups/:id/members with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: 'MEMBER',
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks POST .../role-assignments (grant a Role) with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: 'ADMIN' })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks DELETE .../members/:membershipId with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${created.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks POST /groups/:id/leave with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/leave`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks POST /groups/:id/transfer-ownership with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN),
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });
  });

  describe('unarchive', () => {
    it('allows the owner to restore an archived group', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const restored = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );

      expect(restored.status).toBe('ACTIVE');
    });

    it('forbids an admin from restoring the group - 403', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.ADMIN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });

    it('forbids a plain member from restoring the group - 403', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await archiveGroup(OWNER_TOKEN, created.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/unarchive`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(403);
    });

    it('rejects unarchiving an already-active group with 409 GROUP_ACTIVE', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ACTIVE');
    });

    it('rejects unarchiving a READ_ONLY group with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('allows editing and member management again after restoring, without touching membership rows', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );
      await archiveGroup(OWNER_TOKEN, created.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/unarchive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(groupPayload({ name: 'Active Again' }))
          .expect(200),
      );
      expect(updated.name).toBe('Active Again');

      const members = await bodyOf<GroupMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      // Archiving/unarchiving must never touch membership rows: same ids,
      // same roles, same statuses as before the archive/unarchive cycle.
      expect(members).toHaveLength(2);
      const secondMembership = members.find((m) => m.id === membership.id);
      expect(secondMembership?.rootRoles).toEqual([GroupRole.MEMBER]);
      expect(secondMembership?.status).toBe('ACTIVE');
    });
  });

  describe('READ_ONLY status', () => {
    it('OWNER can set an ACTIVE group to READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/read-only`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );

      expect(updated.status).toBe('READ_ONLY');
    });

    it('ADMIN cannot set the group to READ_ONLY - 403', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.ADMIN);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/read-only`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(403);
    });

    it('rejects setting an already-READ_ONLY group to read-only again with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/read-only`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('rejects setting an ARCHIVED group to read-only with 409 GROUP_ARCHIVED (ARCHIVED -> READ_ONLY unsupported)', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/read-only`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('OWNER can reactivate a READ_ONLY group', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/activate`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );

      expect(updated.status).toBe('ACTIVE');
    });

    it('ADMIN cannot reactivate a READ_ONLY group - 403', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.ADMIN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/activate`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(403);
    });

    it('MEMBER cannot reactivate a READ_ONLY group - 403', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/activate`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(403);
    });

    it('rejects activating an ACTIVE group with 409 GROUP_ACTIVE', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/activate`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ACTIVE');
    });

    it('rejects activating an ARCHIVED group with 409 GROUP_ARCHIVED (must use /unarchive instead)', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/activate`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('OWNER can archive directly from READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const archived = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );

      expect(archived.status).toBe('ARCHIVED');
    });

    it('still allows reading group details and member list while READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(200),
      );
      expect(details.status).toBe('READ_ONLY');

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}/members`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(200);
    });

    it('blocks PATCH /groups/:id (edit) with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(groupPayload({ name: 'Nope' }))
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks POST /groups/:id/members (add member) with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: 'MEMBER',
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks POST /groups/:id/leave with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/leave`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks POST /groups/:id/transfer-ownership with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN),
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks POST .../role-assignments (grant a Role) with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ membershipId: membership.id, role: 'ADMIN' })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks DELETE .../members/:membershipId with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${created.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('does not create, remove, or change membership rows across a READ_ONLY -> ACTIVE cycle', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );

      await setReadOnlyGroup(OWNER_TOKEN, created.id);
      await activateGroup(OWNER_TOKEN, created.id);

      const members = await bodyOf<GroupMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(members).toHaveLength(2);
      const secondMembership = members.find((m) => m.id === membership.id);
      expect(secondMembership?.rootRoles).toEqual([GroupRole.MEMBER]);
      expect(secondMembership?.status).toBe('ACTIVE');
    });
  });
});
