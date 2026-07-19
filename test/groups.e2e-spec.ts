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
import { TransferOwnershipResponseDto } from '../src/groups/dto/transfer-ownership-response.dto';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
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
    await cleanup.nativeDelete(GroupMembership, {
      group: { $in: createdGroupIds },
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
      visibility: 'PUBLIC',
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
      expect(members[0].role).toBe(GroupRole.OWNER);
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
      expect(list.find((item) => item.id === created.id)?.myRole).toBe(
        GroupRole.OWNER,
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

      expect(membership.role).toBe(GroupRole.INSTRUCTOR);
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

    it('changes the role of a non-owner member', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
        GroupRole.MEMBER,
      );

      const updated = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ role: 'ADMIN' })
          .expect(200),
      );

      expect(updated.role).toBe('ADMIN');
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

    it('cannot change the owner role directly - 409 CANNOT_CHANGE_OWNER_ROLE', async () => {
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
          .patch(`/api/v1/groups/${created.id}/members/${ownerMembership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ role: 'ADMIN' })
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_CHANGE_OWNER_ROLE');
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
      expect(second.role).toBe(GroupRole.ADMIN);
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
      expect(second.role).toBe(GroupRole.INSTRUCTOR);
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
      first.group = em.getReference(Group, created.id);
      first.user = em.getReference(User, userId as string);
      first.role = GroupRole.MEMBER;
      first.joinedAt = new Date();
      await em.persistAndFlush(first);

      const second = new GroupMembership();
      second.group = em.getReference(Group, created.id);
      second.user = em.getReference(User, userId as string);
      second.role = GroupRole.ADMIN;
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
    it('transfers ownership to an existing member and reassigns the previous owner role', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.MEMBER);

      const result = await bodyOf<TransferOwnershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN),
            previousOwnerRole: 'ADMIN',
          })
          .expect(201),
      );

      expect(result.newOwner.role).toBe(GroupRole.OWNER);
      expect(result.previousOwner.role).toBe(GroupRole.ADMIN);

      // The old owner (now ADMIN) still cannot archive; only the new owner can.
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

    it('rejects transfer attempted by a non-owner admin with 403', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await addMember(OWNER_TOKEN, created.id, SECOND_TOKEN, GroupRole.ADMIN);
      await addMember(OWNER_TOKEN, created.id, THIRD_TOKEN, GroupRole.MEMBER);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send({
          newOwnerUserId: localUserIdByToken.get(THIRD_TOKEN),
          previousOwnerRole: 'ADMIN',
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
            previousOwnerRole: 'ADMIN',
          })
          .expect(400),
      );
      expect(response.code).toBe('TARGET_NOT_A_MEMBER');
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

    it('blocks PATCH .../members/:membershipId (role change) with 409 GROUP_ARCHIVED', async () => {
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
          .patch(`/api/v1/groups/${created.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ role: 'ADMIN' })
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
            previousOwnerRole: 'ADMIN',
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
      expect(secondMembership?.role).toBe(GroupRole.MEMBER);
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
            previousOwnerRole: 'ADMIN',
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks PATCH .../members/:membershipId (role change) with 409 GROUP_READ_ONLY', async () => {
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
          .patch(`/api/v1/groups/${created.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ role: 'ADMIN' })
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
      expect(secondMembership?.role).toBe(GroupRole.MEMBER);
      expect(secondMembership?.status).toBe('ACTIVE');
    });
  });
});
