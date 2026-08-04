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
import { CommunityNotificationSettingsResponseDto } from '../src/groups/dto/community-notification-settings-response.dto';
import { SectionMembershipResponseDto } from '../src/groups/dto/section-membership-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionBan } from '../src/groups/entities/section-ban.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
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

// Membership/RoleAssignments rebuild: a Group has no membership at all
// (only OWNER/ADMIN via direct grant/transfer) - ban/suspend/notification-
// settings only ever apply to a Section, so every such scenario below
// creates a Section under the Group and targets that instead. Delete/
// archive/audit-log-on-creation remain Group-level, since those are
// lifecycle actions on the entity itself, not membership actions.
describe('Community Administration (e2e)', () => {
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
      await cleanup.nativeDelete(SectionBan, {
        section: { $in: createdSectionIds },
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
    createdSectionIds.push(created.id);
    return created;
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
      await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        ADMIN_TOKEN,
        GroupRole.ADMIN,
      );

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

  // ─── Ban / Unban (Section-only - Group has no membership) ─────────────────

  describe('Ban / Unban Member', () => {
    async function makeSection(name: string): Promise<SectionResponseDto> {
      const root = await createGroup(OWNER_TOKEN, { name: `${name} Root` });
      return createSection(OWNER_TOKEN, root.id, { name });
    }

    it('bans a member, ending their membership and blocking rejoin, then unban allows rejoining', async () => {
      const section = await makeSection('Ban Flow');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${membership.id}/ban`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ reason: 'Repeated rule violations' })
        .expect(204);

      const bannedMembership = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members/${membership.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(bannedMembership.status).toBe('ARCHIVED');
      expect(bannedMembership.endReason).toBe('BANNED');

      // Public Section -> normally auto-joins, but the ban must block it.
      const joinResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/join`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ targetType: 'SECTION' })
          .expect(403),
      );
      expect(joinResponse.code).toBe('USER_BANNED');

      // Unban lifts the block.
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${membership.id}/unban`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const rejoinResult: unknown = await bodyOf(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/join`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ targetType: 'SECTION' })
          .expect(200),
      );
      expect(rejoinResult).toEqual({ joined: true });
    });

    it('rejects re-banning the same (now-archived) membership with 404 MEMBERSHIP_NOT_FOUND - banMember only ever targets an ACTIVE membership, so ALREADY_BANNED is a DB-race-only path, not reachable via two sequential calls (see the unit tests for that race)', async () => {
      const section = await makeSection('Double Ban');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${membership.id}/ban`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(204);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/members/${membership.id}/ban`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({})
          .expect(404),
      );
      expect(response.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('rejects unbanning a member with no active ban - 404 BAN_NOT_FOUND', async () => {
      const section = await makeSection('Nothing To Unban');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/members/${membership.id}/unban`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(404),
      );
      expect(response.code).toBe('BAN_NOT_FOUND');
    });

    it('cannot ban a member who owns the Section - 409 CANNOT_BAN_OWNER', async () => {
      const section = await makeSection('Ban Owner');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      // A second ADMIN so someone still holds ban permission after the
      // transfer below - the original OWNER keeps only MEMBER afterward.
      await addSectionMember(
        OWNER_TOKEN,
        section.id,
        ADMIN_TOKEN,
        GroupRole.ADMIN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(MEMBER_TOKEN) })
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/members/${membership.id}/ban`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({})
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_BAN_OWNER');
    });

    it('forbids a plain MEMBER from banning another member - 403', async () => {
      const section = await makeSection('Member Cannot Ban');
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      const target = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        ADMIN_TOKEN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${target.id}/ban`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({})
        .expect(403);
    });
  });

  // ─── Suspend / Unsuspend (Section-only) ────────────────────────────────────

  describe('Suspend / Unsuspend Member', () => {
    async function makeSection(name: string): Promise<SectionResponseDto> {
      const root = await createGroup(OWNER_TOKEN, { name: `${name} Root` });
      return createSection(OWNER_TOKEN, root.id, { name });
    }

    it('suspends a member (READ_ONLY), restricts their permissions, then unsuspend restores ACTIVE', async () => {
      const section = await makeSection('Suspend Flow');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      const suspended = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/members/${membership.id}/suspend`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ reason: 'Taking a break' })
          .expect(201),
      );
      expect(suspended.status).toBe('READ_ONLY');

      // Still visible/readable while suspended.
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);

      // But every write is denied, despite holding ADMIN.
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ name: 'Should not apply' })
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');

      const unsuspended = await bodyOf<SectionMembershipResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/members/${membership.id}/unsuspend`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(unsuspended.status).toBe('ACTIVE');

      // ADMIN permissions are restored now that suspension is lifted.
      // Section update is full-replace (see update-section.schema.ts) -
      // every required field must be sent, not just the one changing.
      const updated = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({
            name: 'Restored Admin',
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
          })
          .expect(200),
      );
      expect(updated.name).toBe('Restored Admin');
    });

    it('rejects re-suspending the same (now READ_ONLY) membership with 404 MEMBERSHIP_NOT_FOUND - suspendMember only ever targets an ACTIVE membership, so MEMBERSHIP_ALREADY_SUSPENDED is a DB-race-only path, not reachable via two sequential calls (see the unit tests for that race)', async () => {
      const section = await makeSection('Double Suspend');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${membership.id}/suspend`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(201);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/members/${membership.id}/suspend`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({})
          .expect(404),
      );
      expect(response.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('rejects unsuspending a membership that is not currently suspended - 409 MEMBERSHIP_NOT_SUSPENDED', async () => {
      const section = await makeSection('Nothing To Unsuspend');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/members/${membership.id}/unsuspend`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('MEMBERSHIP_NOT_SUSPENDED');
    });

    it('rejects a suspend request with a past `until` date - 400 VALIDATION_ERROR', async () => {
      const section = await makeSection('Past Until');
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/members/${membership.id}/suspend`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ until: '2020-01-01T00:00:00.000Z' })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('forbids a plain MEMBER from suspending another member - 403', async () => {
      const section = await makeSection('Member Cannot Suspend');
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      const target = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        ADMIN_TOKEN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${target.id}/suspend`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({})
        .expect(403);
    });
  });

  // ─── Audit Log ────────────────────────────────────────────────────────────

  describe('Audit Log', () => {
    it('records CREATE_COMMUNITY on Group creation and lists it via the generic paginated endpoint', async () => {
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

    it("records BAN/UNBAN and SUSPEND/UNSUSPEND actions under the Section's own audit log - never the parent Group's (no inheritance)", async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Moderation Audited Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Moderation Audited Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${membership.id}/suspend`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(201);
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/members/${membership.id}/unsuspend`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const sectionPage = await bodyOf<{ data: { action: string }[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/audit-log`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const sectionActions = sectionPage.data.map((entry) => entry.action);
      expect(sectionActions).toEqual(
        expect.arrayContaining(['SUSPEND', 'UNSUSPEND']),
      );

      const rootPage = await bodyOf<{ data: { action: string }[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/audit-log`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rootActions = rootPage.data.map((entry) => entry.action);
      expect(rootActions).not.toEqual(
        expect.arrayContaining(['SUSPEND', 'UNSUSPEND']),
      );
    });

    it('filters by action and by actorId', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Filtered Audit Log',
      });

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

    it('forbids a plain Section MEMBER from viewing that Section audit log - 403', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Member Cannot View Log Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Member Cannot View Log Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/audit-log`)
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

  // ─── Community Notification Settings (Section-only) ───────────────────────

  describe('Community Notification Settings', () => {
    it('returns every default as true before any update, then lets a plain member (only MEMBER) patch a subset', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Notification Defaults Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Notification Defaults Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

      const defaults = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/notification-settings`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(defaults).toMatchObject({
        communityId: section.id,
        newJoinRequests: true,
        roleChanges: true,
        communityDeleted: true,
      });

      const updated = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/sections/${section.id}/notification-settings`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ newJoinRequests: false, roleChanges: false })
          .expect(200),
      );
      expect(updated.newJoinRequests).toBe(false);
      expect(updated.roleChanges).toBe(false);
      expect(updated.communityDeleted).toBe(true);

      const refetched = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/notification-settings`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(refetched.newJoinRequests).toBe(false);
    });

    it('returns 404 GROUP_NOT_FOUND for a non-member', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Notification Non Member Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Notification Non Member Section',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/notification-settings`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('rejects an unrecognized field with 400 VALIDATION_ERROR (schema is strict)', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Notification Strict Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Notification Strict Section',
      });

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/sections/${section.id}/notification-settings`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ notARealField: true })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Expanded Capability Flags (GET /community/home) ──────────────────────

  describe('Expanded capability flags on GET /community/home', () => {
    it('grants OWNER-only flags to the Group OWNER and withholds them from an ADMIN in the same Group', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Capability Flags Community',
      });
      await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        ADMIN_TOKEN,
        GroupRole.ADMIN,
      );

      const ownerHome = await bodyOf<{
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(ownerHome.capabilities.canDeleteGroupIds).toContain(created.id);
      expect(ownerHome.capabilities.canTransferOwnershipInGroupIds).toContain(
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
      expect(adminHome.capabilities.canDeleteGroupIds).not.toContain(
        created.id,
      );
      expect(
        adminHome.capabilities.canTransferOwnershipInGroupIds,
      ).not.toContain(created.id);
      // But ADMIN-tier flags ARE granted.
      expect(adminHome.capabilities.canViewAuditLogInGroupIds).toContain(
        created.id,
      );
    });

    it('grants Section-only moderation flags (ban/suspend/manage members/view members) to a Section ADMIN, never to a Group', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Section Moderation Capability Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Section Moderation Capability Section',
      });
      await addSectionMember(
        OWNER_TOKEN,
        section.id,
        ADMIN_TOKEN,
        GroupRole.ADMIN,
      );

      const adminHome = await bodyOf<{
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      expect(adminHome.capabilities.canBanMembersInSectionIds).toContain(
        section.id,
      );
      expect(adminHome.capabilities.canSuspendMembersInSectionIds).toContain(
        section.id,
      );
      expect(adminHome.capabilities.canManageMembersInSectionIds).toContain(
        section.id,
      );
      expect(adminHome.capabilities.canViewAuditLogInSectionIds).toContain(
        section.id,
      );
    });

    it('grants canManageNotificationsInSectionIds to a zero-extra-Role ACTIVE Section member', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Notifications Capability Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Notifications Capability Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

      const memberHome = await bodyOf<{
        capabilities: Record<string, string[] | boolean>;
      }>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(
        memberHome.capabilities.canManageNotificationsInSectionIds,
      ).toContain(section.id);
      // No ADMIN/OWNER Role anywhere for this Section -> every Role-gated
      // flag is empty for it.
      expect(
        memberHome.capabilities.canManageMembersInSectionIds,
      ).not.toContain(section.id);
    });

    it('still lists canRestoreGroupIds/canDeleteGroupIds for an ARCHIVED Group, even though it is absent from myCommunities', async () => {
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
      expect(home.capabilities.canRestoreGroupIds).toContain(created.id);
      expect(home.capabilities.canDeleteGroupIds).toContain(created.id);
    });

    it('keeps a suspended Section member visible in myCommunities with only READ_ONLY-safe capabilities', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Suspended Capability Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Suspended Capability Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members/${membership.id}/suspend`)
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
      expect(home.myCommunities.map((c) => c.id)).toContain(section.id);
      expect(home.capabilities.canViewMembersInSectionIds).toContain(
        section.id,
      );
      expect(home.capabilities.canViewAuditLogInSectionIds).toContain(
        section.id,
      );
      // Every operational (non-READ_ONLY-safe) flag is withheld despite
      // holding ADMIN.
      expect(home.capabilities.canManageMembersInSectionIds).not.toContain(
        section.id,
      );
      expect(home.capabilities.canBanMembersInSectionIds).not.toContain(
        section.id,
      );
    });
  });
});
