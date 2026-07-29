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
import { CommunityNotificationSettingsResponseDto } from '../src/groups/dto/community-notification-settings-response.dto';
import { GroupMembershipResponseDto } from '../src/groups/dto/group-membership-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupBan } from '../src/groups/entities/group-ban.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const OWNER_TOKEN = 'valid-comm-admin-owner-token';
const ADMIN_TOKEN = 'valid-comm-admin-admin-token';
const MEMBER_TOKEN = 'valid-comm-admin-member-token';
const OUTSIDER_TOKEN = 'valid-comm-admin-outsider-token';

const OWNER_CLERK_ID = 'user_test_comm_admin_owner';
const ADMIN_CLERK_ID = 'user_test_comm_admin_admin';
const MEMBER_CLERK_ID = 'user_test_comm_admin_member';
const OUTSIDER_CLERK_ID = 'user_test_comm_admin_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_comm_admin_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_comm_admin_owner' },
  },
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_comm_admin_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_comm_admin_admin' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_comm_admin_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_comm_admin_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_comm_admin_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_comm_admin_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/comm-admin-owner.png',
    primaryEmailAddress: { emailAddress: 'comm.admin.owner@example.com' },
  },
  [ADMIN_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/comm-admin-admin.png',
    primaryEmailAddress: { emailAddress: 'comm.admin.admin@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/comm-admin-member.png',
    primaryEmailAddress: { emailAddress: 'comm.admin.member@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/comm-admin-outsider.png',
    primaryEmailAddress: { emailAddress: 'comm.admin.outsider@example.com' },
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

describe('Community Administration (e2e)', () => {
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
    await cleanup.nativeDelete(GroupBan, {
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
      name: 'Grupo Berimbau',
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

  // ─── Delete Community ─────────────────────────────────────────────────────

  describe('Delete Community', () => {
    it('allows the OWNER to permanently delete the Community', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'To Delete' });

      const deleted = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/delete`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );

      expect(deleted.status).toBe('DELETED');

      // Historical data (the Group itself) remains readable afterward.
      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(details.status).toBe('DELETED');
    });

    it('is terminal - deleting an already-DELETED Group returns 409 GROUP_DELETED', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Delete Twice' });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/delete`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/delete`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_DELETED');
    });

    it('blocks every other write on a DELETED Group with 409 GROUP_DELETED', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Delete Blocks Writes',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/delete`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(groupPayload({ name: 'Should not apply' }))
          .expect(409),
      );
      expect(response.code).toBe('GROUP_DELETED');
    });

    it('forbids an ADMIN from deleting the Community - 403', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Admin Cannot Delete',
      });
      await addMember(OWNER_TOKEN, created.id, ADMIN_TOKEN, GroupRole.ADMIN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/delete`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });

    it('rejects deleting a Community that still has an active Child Group - 409 GROUP_HAS_ACTIVE_CHILDREN', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Has Active Child' });
      await createSection(OWNER_TOKEN, root.id, {
        name: 'Active Child',
      });

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${root.id}/delete`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_HAS_ACTIVE_CHILDREN');
    });

    it('allows deleting a Community once every Child Group is archived first', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Root With Archived Child',
      });
      const child = await createSection(OWNER_TOKEN, root.id, {
        name: 'Archived Child',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${child.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const deleted = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${root.id}/delete`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(deleted.status).toBe('DELETED');
    });

    it('returns 404 for a non-existent group id', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/groups/11111111-1111-4111-8111-111111111111/delete')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });
  });

  // ─── Ban / Unban ──────────────────────────────────────────────────────────

  describe('Ban / Unban Member', () => {
    it('bans a member, ending their membership and blocking rejoin, then unban allows rejoining', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Ban Flow' });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${membership.id}/ban`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ reason: 'Repeated rule violations' })
        .expect(204);

      const bannedMembership = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(bannedMembership.status).toBe('ARCHIVED');
      expect(bannedMembership.endReason).toBe('BANNED');

      // Public group -> normally auto-joins, but the ban must block it.
      const joinResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/join`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ targetType: 'GROUP' })
          .expect(403),
      );
      expect(joinResponse.code).toBe('USER_BANNED');

      // Unban lifts the block.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${membership.id}/unban`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const rejoinResult: unknown = await bodyOf(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/join`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ targetType: 'GROUP' })
          .expect(200),
      );
      expect(rejoinResult).toEqual({ joined: true });
    });

    it('rejects re-banning the same (now-archived) membership with 404 MEMBERSHIP_NOT_FOUND - banMember only ever targets an ACTIVE membership, so ALREADY_BANNED is a DB-race-only path, not reachable via two sequential calls (see the unit tests for that race)', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Double Ban' });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${membership.id}/ban`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(204);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members/${membership.id}/ban`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({})
          .expect(404),
      );
      expect(response.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('rejects unbanning a member with no active ban - 404 BAN_NOT_FOUND', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Nothing To Unban',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members/${membership.id}/unban`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(404),
      );
      expect(response.code).toBe('BAN_NOT_FOUND');
    });

    it('cannot ban a member who owns a Child Group - 409 CANNOT_BAN_OWNER', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Ban Owner Root' });
      const child = await createSection(OWNER_TOKEN, root.id, {
        name: 'Ban Owner Child',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        root.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${child.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(MEMBER_TOKEN) })
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${root.id}/members/${membership.id}/ban`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({})
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_BAN_OWNER');
    });

    it('forbids a plain MEMBER from banning another member - 403', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Member Cannot Ban',
      });
      await addMember(OWNER_TOKEN, created.id, MEMBER_TOKEN, GroupRole.MEMBER);
      const target = await addMember(
        OWNER_TOKEN,
        created.id,
        ADMIN_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${target.id}/ban`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({})
        .expect(403);
    });
  });

  // ─── Suspend / Unsuspend ────────────────────────────────────────────────

  describe('Suspend / Unsuspend Member', () => {
    it('suspends a member (READ_ONLY), restricts their permissions, then unsuspend restores ACTIVE', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Suspend Flow' });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      const suspended = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members/${membership.id}/suspend`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ reason: 'Taking a break' })
          .expect(201),
      );
      expect(suspended.status).toBe('READ_ONLY');

      // Still visible/readable while suspended.
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);

      // But every write is denied, despite holding ADMIN.
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send(groupPayload({ name: 'Should not apply' }))
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');

      const unsuspended = await bodyOf<GroupMembershipResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/groups/${created.id}/members/${membership.id}/unsuspend`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(unsuspended.status).toBe('ACTIVE');

      // ADMIN permissions are restored now that suspension is lifted.
      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send(groupPayload({ name: 'Restored Admin' }))
          .expect(200),
      );
      expect(updated.name).toBe('Restored Admin');
    });

    it('rejects re-suspending the same (now READ_ONLY) membership with 404 MEMBERSHIP_NOT_FOUND - suspendMember only ever targets an ACTIVE membership, so MEMBERSHIP_ALREADY_SUSPENDED is a DB-race-only path, not reachable via two sequential calls (see the unit tests for that race)', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Double Suspend',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${membership.id}/suspend`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members/${membership.id}/suspend`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({})
          .expect(404),
      );
      expect(response.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('rejects unsuspending a membership that is not currently suspended - 409 MEMBERSHIP_NOT_SUSPENDED', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Nothing To Unsuspend',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/groups/${created.id}/members/${membership.id}/unsuspend`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('MEMBERSHIP_NOT_SUSPENDED');
    });

    it('rejects a suspend request with a past `until` date - 400 VALIDATION_ERROR', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Past Until' });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/members/${membership.id}/suspend`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ until: '2020-01-01T00:00:00.000Z' })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('forbids a plain MEMBER from suspending another member - 403', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Member Cannot Suspend',
      });
      await addMember(OWNER_TOKEN, created.id, MEMBER_TOKEN, GroupRole.MEMBER);
      const target = await addMember(
        OWNER_TOKEN,
        created.id,
        ADMIN_TOKEN,
        GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${target.id}/suspend`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({})
        .expect(403);
    });
  });

  // ─── Audit Log ────────────────────────────────────────────────────────────

  describe('Audit Log', () => {
    it('records CREATE_COMMUNITY on creation and lists it via the generic paginated endpoint', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Audited Community',
      });

      const page = await bodyOf<{
        data: { action: string; actor: { id: string } | null }[];
        meta: { totalItems: number; page: number; limit: number };
      }>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/audit-log`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(page.meta.totalItems).toBeGreaterThanOrEqual(1);
      const createEntry = page.data.find(
        (entry) => entry.action === 'CREATE_COMMUNITY',
      );
      expect(createEntry).toBeDefined();
      expect(createEntry?.actor?.id).toBe(localUserIdByToken.get(OWNER_TOKEN));
    });

    it('records BAN/UNBAN and SUSPEND/UNSUSPEND actions', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Moderation Audited',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.MEMBER,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${membership.id}/suspend`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${membership.id}/unsuspend`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const page = await bodyOf<{ data: { action: string }[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/audit-log`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const actions = page.data.map((entry) => entry.action);
      expect(actions).toEqual(expect.arrayContaining(['SUSPEND', 'UNSUSPEND']));
    });

    it('filters by action and by actorId', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Filtered Audit Log',
      });
      await addMember(OWNER_TOKEN, created.id, MEMBER_TOKEN, GroupRole.MEMBER);

      const onlyAdd = await bodyOf<{ data: { action: string }[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/audit-log`)
          .query({ action: 'CREATE_COMMUNITY' })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(
        onlyAdd.data.every((entry) => entry.action === 'CREATE_COMMUNITY'),
      ).toBe(true);

      const byActor = await bodyOf<{ data: unknown[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/audit-log`)
          .query({ actorId: localUserIdByToken.get(OWNER_TOKEN) as string })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(byActor.data.length).toBeGreaterThanOrEqual(1);
    });

    it('sorts ascending when sort=createdAt, descending (default) otherwise', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Sorted Audit Log',
      });
      await addMember(OWNER_TOKEN, created.id, MEMBER_TOKEN, GroupRole.MEMBER);

      const ascending = await bodyOf<{ data: { createdAt: string }[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/audit-log`)
          .query({ sort: 'createdAt' })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const timestamps = ascending.data.map((entry) =>
        new Date(entry.createdAt).getTime(),
      );
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });

    it('rejects an invalid query with 400 VALIDATION_ERROR', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Bad Audit Query',
      });

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/audit-log`)
          .query({ action: 'NOT_A_REAL_ACTION' })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('forbids a plain MEMBER from viewing the Audit Log - 403', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Member Cannot View Log',
      });
      await addMember(OWNER_TOKEN, created.id, MEMBER_TOKEN, GroupRole.MEMBER);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/audit-log`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });

    it('returns 404 GROUP_NOT_FOUND for an outsider (never confirms existence)', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Hidden From Outsider',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}/audit-log`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });
  });

  // ─── Community Notification Settings ──────────────────────────────────────

  describe('Community Notification Settings', () => {
    it('returns every default as true before any update, then lets a plain member (zero Role Assignments) patch a subset', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Notification Defaults',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ userId: localUserIdByToken.get(MEMBER_TOKEN) })
        .expect(201);

      const defaults = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/notification-settings`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(defaults).toMatchObject({
        communityId: created.id,
        newJoinRequests: true,
        roleChanges: true,
        communityDeleted: true,
      });

      const updated = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}/notification-settings`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ newJoinRequests: false, roleChanges: false })
          .expect(200),
      );
      expect(updated.newJoinRequests).toBe(false);
      expect(updated.roleChanges).toBe(false);
      expect(updated.communityDeleted).toBe(true);

      const refetched = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/notification-settings`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(refetched.newJoinRequests).toBe(false);
    });

    it('returns 404 GROUP_NOT_FOUND for a non-member', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Notification Non Member',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}/notification-settings`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('rejects an unrecognized field with 400 VALIDATION_ERROR (schema is strict)', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Notification Strict',
      });

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}/notification-settings`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ notARealField: true })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Expanded Capability Flags (GET /community/home) ──────────────────────

  describe('Expanded capability flags on GET /community/home', () => {
    it('grants OWNER-only flags to the OWNER and withholds them from an ADMIN in the same community', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Capability Flags Community',
      });
      await addMember(OWNER_TOKEN, created.id, ADMIN_TOKEN, GroupRole.ADMIN);

      const ownerHome = await bodyOf<{
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(ownerHome.capabilities.canDeleteCommunityIds).toContain(
        created.id,
      );
      expect(
        ownerHome.capabilities.canTransferOwnershipInCommunityIds,
      ).toContain(created.id);
      expect(ownerHome.capabilities.canBanMembersInCommunityIds).toContain(
        created.id,
      );

      const adminHome = await bodyOf<{
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      expect(adminHome.capabilities.canDeleteCommunityIds).not.toContain(
        created.id,
      );
      expect(
        adminHome.capabilities.canTransferOwnershipInCommunityIds,
      ).not.toContain(created.id);
      // But ADMIN-tier moderation flags ARE granted.
      expect(adminHome.capabilities.canBanMembersInCommunityIds).toContain(
        created.id,
      );
      expect(adminHome.capabilities.canSuspendMembersInCommunityIds).toContain(
        created.id,
      );
      expect(adminHome.capabilities.canViewAuditLogInCommunityIds).toContain(
        created.id,
      );
    });

    it('grants canManageNotificationsInCommunityIds to a zero-Role ACTIVE member', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Notifications Capability Community',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ userId: localUserIdByToken.get(MEMBER_TOKEN) })
        .expect(201);

      const memberHome = await bodyOf<{
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(
        memberHome.capabilities.canManageNotificationsInCommunityIds,
      ).toContain(created.id);
      // No Role Assignment anywhere for this community -> every Role-gated
      // flag is empty for it.
      expect(
        memberHome.capabilities.canManageMembersInCommunityIds,
      ).not.toContain(created.id);
    });

    it('still lists canRestoreCommunityIds/canDeleteCommunityIds for an ARCHIVED community, even though it is absent from myCommunities', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Archived Capability Community',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const home = await bodyOf<{
        myCommunities: { id: string }[];
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(home.myCommunities.map((c) => c.id)).not.toContain(created.id);
      expect(home.capabilities.canRestoreCommunityIds).toContain(created.id);
      expect(home.capabilities.canDeleteCommunityIds).toContain(created.id);
    });

    it('keeps a suspended member visible in myCommunities with only READ_ONLY-safe capabilities', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Suspended Capability Community',
      });
      const membership = await addMember(
        OWNER_TOKEN,
        created.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/members/${membership.id}/suspend`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(201);

      const home = await bodyOf<{
        myCommunities: { id: string }[];
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(home.myCommunities.map((c) => c.id)).toContain(created.id);
      expect(home.capabilities.canViewMembersInCommunityIds).toContain(
        created.id,
      );
      expect(home.capabilities.canViewAuditLogInCommunityIds).toContain(
        created.id,
      );
      // Every operational (non-READ_ONLY-safe) flag is withheld despite
      // holding ADMIN.
      expect(home.capabilities.canManageMembersInCommunityIds).not.toContain(
        created.id,
      );
      expect(home.capabilities.canBanMembersInCommunityIds).not.toContain(
        created.id,
      );

      // GET /groups ("my groups") also still lists it - not just Community Home.
      const mine = await bodyOf<{ id: string }[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(mine.map((g) => g.id)).toContain(created.id);
    });
  });
});
