/**
 * E2E tests for Group lifecycle (GET/POST/PATCH .../groups...).
 *
 * Under the Membership/RoleAssignments rebuild, a Group has no membership
 * at all - no join/leave/member-list/ban/suspend/cohort-assignment, and no
 * MEMBER role. The only Roles a Group ever grants are OWNER (exactly one,
 * always the creator, moved only via transferOwnership) and ADMIN (granted
 * directly via RoleAssignmentsController, dual-mounted with Section - see
 * role-assignments.e2e-spec.ts for the full grant/revoke contract). This
 * file therefore covers Group's own lifecycle only: create, listMine,
 * getById, update, archive/unarchive/read-only/activate, delete, and
 * transfer-ownership. Everything that used to be "Group membership"
 * (join/leave/add/remove/ban/suspend a member, cohort assignment,
 * ownership-blocks-leaving-while-owning-something) now belongs to Section -
 * see organization-membership.e2e-spec.ts, community-administration.e2e-spec.ts,
 * role-assignments.e2e-spec.ts, and section-membership-lifecycle.e2e-spec.ts.
 */

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
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { GroupSummaryResponseDto } from '../src/groups/dto/group-summary-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { TransferOwnershipResponseDto } from '../src/groups/dto/transfer-ownership-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
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
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(RoleAssignment, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        group: { $in: createdGroupIds },
      });
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

  // Group only ever grants OWNER/ADMIN - a direct RoleAssignment, no
  // membership involved at all.
  async function grantGroupRole(
    ownerToken: string,
    groupId: string,
    memberToken: string,
    role: GroupRole = GroupRole.ADMIN,
  ): Promise<RoleAssignmentResponseDto> {
    return bodyOf<RoleAssignmentResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/role-assignments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: localUserIdByToken.get(memberToken), role })
        .expect(201),
    );
  }

  async function getGroupRoleAssignments(
    token: string,
    groupId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    return bodyOf<RoleAssignmentResponseDto[]>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${groupId}/role-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
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
    it('creates a group and automatically makes the creator OWNER (only Role - Group has no MEMBER tier)', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Nova Geração' });

      expect(created.name).toBe('Nova Geração');
      expect(created.status).toBe('ACTIVE');

      const roleAssignments = await getGroupRoleAssignments(
        OWNER_TOKEN,
        created.id,
      );
      expect(roleAssignments).toHaveLength(1);
      expect(roleAssignments[0].role).toBe(GroupRole.OWNER);
      expect(roleAssignments[0].user.id).toBe(
        localUserIdByToken.get(OWNER_TOKEN),
      );
    });

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/groups')
        .send(groupPayload())
        .expect(401);
    });

    // Group has no location fields (country/city/region/geonameId) as of
    // the organizational-domain rebuild, stage 1 - those live on Section
    // only (see group.entity.ts / section.entity.ts). The full geonameId/
    // country/city/region disambiguation battery (including the "two
    // different Piaski" regression) now lives on Section instead - see
    // create-section.schema.spec.ts and group-hierarchy.e2e-spec.ts's
    // Section creation tests.
    it('creates a Group with no location fields at all, and the response never carries any', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Country City Test',
      });

      expect(created).not.toHaveProperty('country');
      expect(created).not.toHaveProperty('city');
      expect(created).not.toHaveProperty('region');
      expect(created).not.toHaveProperty('geonameId');
    });

    it('silently ignores a country/city/geonameId sent in the create payload - Group never persists them', async () => {
      const created = await createGroup(OWNER_TOKEN, {
        name: 'Group With Stray Location Fields',
        country: 'BR',
        city: 'São Paulo',
        geonameId: 3448439,
      });

      expect(created).not.toHaveProperty('country');
      expect(created).not.toHaveProperty('city');
      expect(created).not.toHaveProperty('geonameId');
    });
  });

  describe('listMine', () => {
    it('lists only groups the caller holds a Role Assignment on', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Only Mine' });

      const list = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(list.map((item) => item.id)).toContain(created.id);
      expect(list.find((item) => item.id === created.id)?.myRoles).toEqual([
        GroupRole.OWNER,
      ]);
    });

    it('excludes a Group the caller holds no Role Assignment on', async () => {
      const created = await createGroup(OWNER_TOKEN, { name: 'Not Mine' });

      const list = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(200),
      );
      expect(list.map((item) => item.id)).not.toContain(created.id);
    });
  });

  describe('getById', () => {
    it('returns 404 for a user with no Role Assignment on this Group at all', async () => {
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

    it('returns group details for OWNER/ADMIN', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
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

    it('allows an ADMIN to edit the group too', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .send(groupPayload({ name: 'Renamed By Admin' }))
          .expect(200),
      );
      expect(updated.name).toBe('Renamed By Admin');
    });

    // Group has no location fields (organizational-domain rebuild, stage
    // 1) - `updateGroupSchema` is `.strict()`, so sending them is rejected
    // outright rather than silently accepted/ignored. The full geonameId/
    // country/city/region edit-time battery (including the legacy-row
    // "predates geonameId" case) now lives on Section only - see
    // update-section.schema.spec.ts.
    it('rejects an edit payload carrying the now-removed location fields', async () => {
      const created = await createGroup(OWNER_TOKEN);

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(groupPayload({ country: 'DE', city: 'Berlin' }))
        .expect(400);
    });

    // Regional settings (timezone/currencyCode) moved to per-User account
    // settings (PATCH /users/me) - a Group never has them, so `groupPayload`
    // above no longer includes them and submitting them here is rejected
    // the same way the location fields above are.
    it('rejects an edit payload carrying the now-removed timezone/currencyCode fields', async () => {
      const created = await createGroup(OWNER_TOKEN);

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(groupPayload({ timezone: 'Europe/Warsaw', currencyCode: 'PLN' }))
        .expect(400);
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

    it('forbids an admin from archiving the group - archive is OWNER-only', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });
  });

  describe('transferOwnership', () => {
    it('transfers ownership atomically: the target must already hold ADMIN, and becomes the sole OWNER', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);

      const result = await bodyOf<TransferOwnershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN) })
          .expect(201),
      );

      expect(result.newOwner.role).toBe(GroupRole.OWNER);
      expect(result.newOwner.user.id).toBe(
        localUserIdByToken.get(SECOND_TOKEN),
      );
      expect(result.previousOwner.role).toBe(GroupRole.OWNER);
      expect(result.previousOwner.revokedAt).not.toBeNull();

      const roleAssignments = await getGroupRoleAssignments(
        SECOND_TOKEN,
        created.id,
      );
      const activeOwners = roleAssignments.filter(
        (ra) => ra.role === GroupRole.OWNER,
      );
      expect(activeOwners).toHaveLength(1);
      expect(activeOwners[0].user.id).toBe(
        localUserIdByToken.get(SECOND_TOKEN),
      );
      // SECOND_TOKEN's original ADMIN grant is untouched by the transfer.
      expect(
        roleAssignments.some(
          (ra) =>
            ra.role === GroupRole.ADMIN &&
            ra.user.id === localUserIdByToken.get(SECOND_TOKEN),
        ),
      ).toBe(true);

      // The old owner held only OWNER (never a separate ADMIN grant), so
      // losing it leaves them with no RoleAssignment on this Group at all -
      // a 404, same as any stranger, never a 403 (which would confirm the
      // Group's existence to them).
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);

      const archived = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(201),
      );
      expect(archived.status).toBe('ARCHIVED');
    });

    it('rejects a smuggled previousOwnerRole field with 400 VALIDATION_ERROR', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);

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
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, THIRD_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(THIRD_TOKEN) })
        .expect(403);
    });

    it('rejects transferring to a user who does not already hold ADMIN - 400 TARGET_NOT_GROUP_ADMIN', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ newOwnerUserId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(400),
      );
      expect(response.code).toBe('TARGET_NOT_GROUP_ADMIN');
    });
  });

  describe('role-assignments on a Group', () => {
    it('grants ADMIN directly via userId - no membership involved', async () => {
      const created = await createGroup(OWNER_TOKEN);

      const granted = await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
      );
      expect(granted.role).toBe(GroupRole.ADMIN);
      expect(granted.user.id).toBe(localUserIdByToken.get(SECOND_TOKEN));
    });

    it('rejects granting the exact same Role twice - 409 ROLE_ASSIGNMENT_ALREADY_EXISTS', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: GroupRole.ADMIN,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_ASSIGNMENT_ALREADY_EXISTS');
    });

    it('forbids a caller with no Role Assignment on the Group from granting one', async () => {
      const created = await createGroup(OWNER_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(SECOND_TOKEN),
          role: GroupRole.ADMIN,
        })
        .expect(404);
    });

    it('revokes an ADMIN Role Assignment', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const granted = await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it('never allows revoking OWNER directly - 409 CANNOT_REMOVE_OWNER, and there is no PATCH to change it instead', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const roleAssignments = await getGroupRoleAssignments(
        OWNER_TOKEN,
        created.id,
      );
      const ownerRoleAssignment = roleAssignments.find(
        (ra) => ra.role === GroupRole.OWNER,
      );

      // There is no PATCH .../role-assignments/:id at all - grantRole and
      // revokeRole are the only two mutations.
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

  describe('archived group (writes blocked)', () => {
    it('still allows OWNER/ADMIN to read group details and see it in "my groups"', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(details.status).toBe('ARCHIVED');

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

    it('blocks POST .../role-assignments (grant a Role) with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: 'ADMIN',
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks DELETE .../role-assignments/:id (revoke a Role) with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const granted = await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
      );
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks POST /groups/:id/transfer-ownership with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);
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
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);
      await archiveGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
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

    it('allows editing again after restoring, without touching any RoleAssignment row', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const granted = await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
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

      // Archiving/unarchiving must never touch any RoleAssignment row -
      // same ids, same roles, still active.
      const roleAssignments = await getGroupRoleAssignments(
        OWNER_TOKEN,
        created.id,
      );
      const secondAssignment = roleAssignments.find(
        (ra) => ra.id === granted.id,
      );
      expect(secondAssignment?.role).toBe(GroupRole.ADMIN);
      expect(secondAssignment?.revokedAt).toBeNull();
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
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);

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
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);
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

    it('still allows reading group details while READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(200),
      );
      expect(details.status).toBe('READ_ONLY');
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

    it('blocks POST /groups/:id/transfer-ownership with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      await grantGroupRole(OWNER_TOKEN, created.id, SECOND_TOKEN);
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
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const secondUserId = localUserIdByToken.get(SECOND_TOKEN);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ userId: secondUserId, role: 'ADMIN' });
      if (res.status !== 409) {
        console.error(
          'DIAG grant-role-readonly failed',
          res.status,
          JSON.stringify(res.body),
          'secondUserId=',
          secondUserId,
          'groupId=',
          created.id,
        );
      }
      expect(res.status).toBe(409);
      const response = res.body as HttpErrorResponse;
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks DELETE .../role-assignments/:id (revoke a Role) with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const granted = await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
      );
      await setReadOnlyGroup(OWNER_TOKEN, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('does not create, remove, or change any RoleAssignment row across a READ_ONLY -> ACTIVE cycle', async () => {
      const created = await createGroup(OWNER_TOKEN);
      const granted = await grantGroupRole(
        OWNER_TOKEN,
        created.id,
        SECOND_TOKEN,
      );

      await setReadOnlyGroup(OWNER_TOKEN, created.id);
      await activateGroup(OWNER_TOKEN, created.id);

      const roleAssignments = await getGroupRoleAssignments(
        OWNER_TOKEN,
        created.id,
      );
      expect(roleAssignments).toHaveLength(2);
      const secondAssignment = roleAssignments.find(
        (ra) => ra.id === granted.id,
      );
      expect(secondAssignment?.role).toBe(GroupRole.ADMIN);
      expect(secondAssignment?.revokedAt).toBeNull();
    });
  });
});
