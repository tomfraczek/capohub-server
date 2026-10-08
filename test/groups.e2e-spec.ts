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
import { createFreshGroupOwner } from './fresh-group-owner.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { GroupSummaryResponseDto } from '../src/groups/dto/group-summary-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { TransferOwnershipResponseDto } from '../src/groups/dto/transfer-ownership-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

// No fixed "OWNER_TOKEN" here (unlike SECOND_TOKEN/THIRD_TOKEN/
// OUTSIDER_TOKEN below, which stay - each is a stable *other* actor
// relative to whichever Group is under test: an ADMIN-to-be, a second
// grantee, a non-member). GroupsService.create now allows at most one
// active FormalGroupAffiliation per user (see USER_ALREADY_HAS_FORMAL_GROUP
// on GroupsService.create) - since every test here creates its own Group to
// exercise in isolation, each now mints its own fresh owner via
// createFreshGroupOwner (see the local createGroup() below), rather than
// reusing one shared owner identity across the whole file the way this used
// to work. A fixed OWNER_TOKEN would 409 on every create after the first.
const SECOND_TOKEN = 'valid-groups-second-token';
const THIRD_TOKEN = 'valid-groups-third-token';
const OUTSIDER_TOKEN = 'valid-groups-outsider-token';

const SECOND_CLERK_ID = 'user_test_groups_second';
const THIRD_CLERK_ID = 'user_test_groups_third';
const OUTSIDER_CLERK_ID = 'user_test_groups_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
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
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below (see
      // user-profile.e2e-spec.ts's identical cleanup step). Every Group
      // created via createGroup() below now sets one automatically (see
      // GroupsService.create).
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // FIXTURE_CLERK_PROFILES, not the old frozen TEST_CLERK_USER_IDS
      // snapshot - createGroup() (via createFreshGroupOwner) registers a
      // fresh fixture user per call, mutating FIXTURE_CLERK_PROFILES in
      // place, so it must be read fresh here to catch every one of them.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
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

  // Mints a brand-new fixture user and has them create a Group - see
  // createFreshGroupOwner's own comment for why this file no longer reuses
  // one fixed OWNER_TOKEN across tests (GroupsService.create now allows at
  // most one active FormalGroupAffiliation per user). The returned object
  // carries the full GroupResponseDto directly (so `created.id`/`.name`/...
  // keep working exactly as before) plus `.token`/`.userId` for the fresh
  // owner, since every test still needs to act as that owner afterward.
  async function createGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto & { token: string; userId: string }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'groups',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
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
      const created = await createGroup({ name: 'Nova Geração' });

      expect(created.name).toBe('Nova Geração');
      expect(created.status).toBe('ACTIVE');

      const roleAssignments = await getGroupRoleAssignments(
        created.token,
        created.id,
      );
      expect(roleAssignments).toHaveLength(1);
      expect(roleAssignments[0].role).toBe(GroupRole.OWNER);
      expect(roleAssignments[0].user.id).toBe(created.userId);
    });

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/groups')
        .send(groupPayload())
        .expect(401);
    });

    // Career History audit follow-up: founderUser/founderNameSnapshot are a
    // permanent record of who founded this Group, set once here and never
    // re-derived from RoleAssignment - see career-timeline-aggregation.
    // service.ts's own comment on why (a founder's RoleAssignment row can
    // be physically deleted on account deletion). Not exposed on
    // GroupResponseDto (no product need for it there yet), so asserted
    // directly against the persisted row.
    it('records the creator as founderUser, with a displayName snapshot', async () => {
      const created = await createGroup({
        name: 'Founder Snapshot Test',
      });

      const em = app.get(EntityManager).fork();
      const group = await em.findOneOrFail(Group, { id: created.id });
      const creator = await em.findOneOrFail(User, {
        id: created.userId,
      });

      expect(group.founderUser?.id).toBe(creator.id);
      expect(group.founderNameSnapshot).toBe(creator.displayName);
    });

    // Group has no location fields (country/city/region/geonameId) as of
    // the organizational-domain rebuild, stage 1 - those live on Section
    // only (see group.entity.ts / section.entity.ts). The full geonameId/
    // country/city/region disambiguation battery (including the "two
    // different Piaski" regression) now lives on Section instead - see
    // create-section.schema.spec.ts and group-hierarchy.e2e-spec.ts's
    // Section creation tests.
    it('creates a Group with no location fields at all, and the response never carries any', async () => {
      const created = await createGroup({
        name: 'Country City Test',
      });

      expect(created).not.toHaveProperty('country');
      expect(created).not.toHaveProperty('city');
      expect(created).not.toHaveProperty('region');
      expect(created).not.toHaveProperty('geonameId');
    });

    it('silently ignores a country/city/geonameId sent in the create payload - Group never persists them', async () => {
      const created = await createGroup({
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
      const created = await createGroup({ name: 'Only Mine' });

      const list = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${created.token}`)
          .expect(200),
      );

      expect(list.map((item) => item.id)).toContain(created.id);
      expect(list.find((item) => item.id === created.id)?.myRoles).toEqual([
        GroupRole.OWNER,
      ]);
    });

    it('excludes a Group the caller holds no Role Assignment on', async () => {
      const created = await createGroup({ name: 'Not Mine' });

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
    it('returns 404 for a user with no Role Assignment on this Private Group at all', async () => {
      const created = await createGroup({ isPublic: false });

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    // The Public-view fallback (RoleAssignmentsService.resolvePublicView) -
    // a stranger with no Role Assignment at all may still read a `isPublic`
    // Group's own details, same as any member would see, so Discover
    // search results are actually viewable before deciding to join (see
    // GroupPermissionsGuard's own comment for the bug this fixes).
    it('returns 200 for a user with no Role Assignment at all on a Public Group', async () => {
      const created = await createGroup({ isPublic: true });

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(200),
      );
      expect(details.id).toBe(created.id);
    });

    it('returns 404 for a non-existent group id', async () => {
      // No Group created in this test at all - any authenticated user gets
      // 404 for an id that doesn't exist, regardless of who they are.
      await request(app.getHttpServer())
        .get('/api/v1/groups/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('returns group details for OWNER/ADMIN', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

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
      const created = await createGroup();

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${created.token}`)
          .send(groupPayload({ name: 'Renamed Group' }))
          .expect(200),
      );

      expect(updated.name).toBe('Renamed Group');
    });

    it('allows an ADMIN to edit the group too', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

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
      const created = await createGroup();

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${created.token}`)
        .send(groupPayload({ country: 'DE', city: 'Berlin' }))
        .expect(400);
    });

    // Regional settings (timezone/currencyCode) moved to per-User account
    // settings (PATCH /users/me) - a Group never has them, so `groupPayload`
    // above no longer includes them and submitting them here is rejected
    // the same way the location fields above are.
    it('rejects an edit payload carrying the now-removed timezone/currencyCode fields', async () => {
      const created = await createGroup();

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${created.id}`)
        .set('Authorization', `Bearer ${created.token}`)
        .send(groupPayload({ timezone: 'Europe/Warsaw', currencyCode: 'PLN' }))
        .expect(400);
    });
  });

  describe('archive', () => {
    it('allows the owner to archive the group', async () => {
      const created = await createGroup();

      const archived = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(201),
      );

      expect(archived.status).toBe('ARCHIVED');
    });

    it('forbids an admin from archiving the group - archive is OWNER-only', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

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
    it('refuses to transfer to an ADMIN who already owns a Group, and the candidates list explains why', async () => {
      const created = await createGroup({ name: 'Transfer Blocked Group' });
      const otherOwner = await createGroup({ name: 'Already Owned Group' });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${created.token}`)
        .send({ userId: otherOwner.userId, role: GroupRole.ADMIN })
        .expect(201);

      const candidates = await bodyOf<
        { user: { id: string }; eligible: boolean; blocker: string | null }[]
      >(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}/ownership-transfer-candidates`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(200),
      );
      expect(
        candidates.find((c) => c.user.id === otherOwner.userId),
      ).toMatchObject({ eligible: false, blocker: 'OWNS_ANOTHER_GROUP' });

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${created.token}`)
          .send({ newOwnerUserId: otherOwner.userId })
          .expect(409),
      );
      expect((error as unknown as { code: string }).code).toBe(
        'TARGET_ALREADY_OWNS_GROUP',
      );
    });

    it('transfers ownership atomically: the target must already hold ADMIN, and becomes the sole OWNER', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

      const result = await bodyOf<TransferOwnershipResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${created.token}`)
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
      // OWNER -> formal membership: the new owner's formal Group is now
      // this one (they had none before).
      const newOwnerAffiliation = await app
        .get(EntityManager)
        .fork()
        .findOne(FormalGroupAffiliation, {
          user: localUserIdByToken.get(SECOND_TOKEN),
          endedOn: null,
        });
      expect(newOwnerAffiliation?.group.id).toBe(created.id);

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
        .set('Authorization', `Bearer ${created.token}`)
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
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${created.token}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN),
            previousOwnerRole: 'ADMIN',
          })
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('rejects transfer attempted by a non-owner admin with 403', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);
      await grantGroupRole(created.token, created.id, THIRD_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send({ newOwnerUserId: localUserIdByToken.get(THIRD_TOKEN) })
        .expect(403);
    });

    it('rejects transferring to a user who does not already hold ADMIN - 400 TARGET_NOT_GROUP_ADMIN', async () => {
      const created = await createGroup();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${created.token}`)
          .send({ newOwnerUserId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(400),
      );
      expect(response.code).toBe('TARGET_NOT_GROUP_ADMIN');
    });
  });

  describe('role-assignments on a Group', () => {
    it('grants ADMIN directly via userId - no membership involved', async () => {
      const created = await createGroup();

      const granted = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );
      expect(granted.role).toBe(GroupRole.ADMIN);
      expect(granted.user.id).toBe(localUserIdByToken.get(SECOND_TOKEN));
    });

    it('rejects granting the exact same Role twice - 409 ROLE_ASSIGNMENT_ALREADY_EXISTS', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/role-assignments`)
          .set('Authorization', `Bearer ${created.token}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: GroupRole.ADMIN,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_ASSIGNMENT_ALREADY_EXISTS');
    });

    it('forbids a caller with no Role Assignment on the Group from granting one', async () => {
      const created = await createGroup();

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
      const created = await createGroup();
      const granted = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
        .set('Authorization', `Bearer ${created.token}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
        .set('Authorization', `Bearer ${created.token}`)
        .expect(404);
    });

    it('never allows revoking OWNER directly - 409 CANNOT_REMOVE_OWNER, and there is no PATCH to change it instead', async () => {
      const created = await createGroup();
      const roleAssignments = await getGroupRoleAssignments(
        created.token,
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
        .set('Authorization', `Bearer ${created.token}`)
        .send({ role: 'ADMIN' })
        .expect(404);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/groups/${created.id}/role-assignments/${ownerRoleAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_OWNER');
    });

    it('lets a Group ADMIN list the roles and grant/revoke ADMIN, like the OWNER', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

      // ADMIN grants ADMIN to someone else...
      const grantedByAdmin = await grantGroupRole(
        SECOND_TOKEN,
        created.id,
        THIRD_TOKEN,
      );
      expect(grantedByAdmin.role).toBe(GroupRole.ADMIN);

      const listed = await getGroupRoleAssignments(SECOND_TOKEN, created.id);
      expect(listed.map((ra) => ra.role).sort()).toEqual(
        [GroupRole.ADMIN, GroupRole.ADMIN, GroupRole.OWNER].sort(),
      );

      // ...and revokes another admin's ADMIN role.
      await request(app.getHttpServer())
        .delete(
          `/api/v1/groups/${created.id}/role-assignments/${grantedByAdmin.id}`,
        )
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(204);

      const after = await getGroupRoleAssignments(created.token, created.id);
      expect(after.map((ra) => ra.id)).not.toContain(grantedByAdmin.id);
    });

    it('never lets a Group ADMIN revoke the OWNER role (409) or grant OWNER (400)', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);
      const ownerAssignment = (
        await getGroupRoleAssignments(SECOND_TOKEN, created.id)
      ).find((ra) => ra.role === GroupRole.OWNER);

      const revokeResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/groups/${created.id}/role-assignments/${ownerAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(409),
      );
      expect(revokeResponse.code).toBe('CANNOT_REMOVE_OWNER');

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(THIRD_TOKEN),
          role: GroupRole.OWNER,
        })
        .expect(400);

      // The OWNER is untouched.
      const after = await getGroupRoleAssignments(created.token, created.id);
      expect(after.filter((ra) => ra.role === GroupRole.OWNER)).toHaveLength(1);
    });

    // A Group has no ordinary members - anyone without an OWNER/ADMIN Role
    // Assignment there (incl. members of its Sections) is a stranger to
    // these routes and gets 404, never a hint that the Group exists.
    it('rejects grant and revoke by a caller without a Group role - 404, nothing changes', async () => {
      const created = await createGroup();
      const admin = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(OUTSIDER_TOKEN),
          role: GroupRole.ADMIN,
        })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${created.id}/role-assignments/${admin.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);

      const after = await getGroupRoleAssignments(created.token, created.id);
      expect(after.map((ra) => ra.id)).toContain(admin.id);
    });

    it('hides the role list from a stranger even on a public Group - 404, never the list', async () => {
      const created = await createGroup({ isPublic: true });

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('returns the role holder with profile identity and avatar, never email-derived fields', async () => {
      const created = await createGroup();
      const granted = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );

      expect(Object.keys(granted.user).sort()).toEqual(
        [
          'apelido',
          'displayName',
          'firstName',
          'id',
          'image',
          'lastName',
        ].sort(),
      );
      expect(Object.keys(granted.user.image).sort()).toEqual(
        ['presetAvatarId', 'type', 'url'].sort(),
      );
    });
  });

  describe('archived group (writes blocked)', () => {
    it('still allows OWNER/ADMIN to read group details and see it in "my groups"', async () => {
      const created = await createGroup();
      await archiveGroup(created.token, created.id);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(200),
      );
      expect(details.status).toBe('ARCHIVED');

      const mine = await bodyOf<GroupSummaryResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${created.token}`)
          .expect(200),
      );
      expect(mine.find((item) => item.id === created.id)?.status).toBe(
        'ARCHIVED',
      );
    });

    it('blocks PATCH /groups/:id with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup();
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${created.token}`)
          .send(groupPayload({ name: 'Should not apply' }))
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks re-archiving an already-archived group with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup();
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks POST .../role-assignments (grant a Role) with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup();
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/role-assignments`)
          .set('Authorization', `Bearer ${created.token}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: 'ADMIN',
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks DELETE .../role-assignments/:id (revoke a Role) with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup();
      const granted = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('blocks POST /groups/:id/transfer-ownership with 409 GROUP_ARCHIVED', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${created.token}`)
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
      const created = await createGroup();
      await archiveGroup(created.token, created.id);

      const restored = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(201),
      );

      expect(restored.status).toBe('ACTIVE');
    });

    it('forbids an admin from restoring the group - 403', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });

    it('rejects unarchiving an already-active group with 409 GROUP_ACTIVE', async () => {
      const created = await createGroup();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ACTIVE');
    });

    it('rejects unarchiving a READ_ONLY group with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup();
      await setReadOnlyGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/unarchive`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('allows editing again after restoring, without touching any RoleAssignment row', async () => {
      const created = await createGroup();
      const granted = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );
      await archiveGroup(created.token, created.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/unarchive`)
        .set('Authorization', `Bearer ${created.token}`)
        .expect(201);

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${created.token}`)
          .send(groupPayload({ name: 'Active Again' }))
          .expect(200),
      );
      expect(updated.name).toBe('Active Again');

      // Archiving/unarchiving must never touch any RoleAssignment row -
      // same ids, same roles, still active.
      const roleAssignments = await getGroupRoleAssignments(
        created.token,
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
      const created = await createGroup();

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/read-only`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(201),
      );

      expect(updated.status).toBe('READ_ONLY');
    });

    it('ADMIN cannot set the group to READ_ONLY - 403', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/read-only`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(403);
    });

    it('rejects setting an already-READ_ONLY group to read-only again with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup();
      await setReadOnlyGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/read-only`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('rejects setting an ARCHIVED group to read-only with 409 GROUP_ARCHIVED (ARCHIVED -> READ_ONLY unsupported)', async () => {
      const created = await createGroup();
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/read-only`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('OWNER can reactivate a READ_ONLY group', async () => {
      const created = await createGroup();
      await setReadOnlyGroup(created.token, created.id);

      const updated = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/activate`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(201),
      );

      expect(updated.status).toBe('ACTIVE');
    });

    it('ADMIN cannot reactivate a READ_ONLY group - 403', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);
      await setReadOnlyGroup(created.token, created.id);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/activate`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(403);
    });

    it('rejects activating an ACTIVE group with 409 GROUP_ACTIVE', async () => {
      const created = await createGroup();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/activate`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ACTIVE');
    });

    it('rejects activating an ARCHIVED group with 409 GROUP_ARCHIVED (must use /unarchive instead)', async () => {
      const created = await createGroup();
      await archiveGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/activate`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_ARCHIVED');
    });

    it('OWNER can archive directly from READ_ONLY', async () => {
      const created = await createGroup();
      await setReadOnlyGroup(created.token, created.id);

      const archived = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/archive`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(201),
      );

      expect(archived.status).toBe('ARCHIVED');
    });

    it('still allows reading group details while READ_ONLY', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);
      await setReadOnlyGroup(created.token, created.id);

      const details = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(200),
      );
      expect(details.status).toBe('READ_ONLY');
    });

    it('blocks PATCH /groups/:id (edit) with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup();
      await setReadOnlyGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${created.id}`)
          .set('Authorization', `Bearer ${created.token}`)
          .send(groupPayload({ name: 'Nope' }))
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks POST /groups/:id/transfer-ownership with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup();
      await grantGroupRole(created.token, created.id, SECOND_TOKEN);
      await setReadOnlyGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${created.token}`)
          .send({
            newOwnerUserId: localUserIdByToken.get(SECOND_TOKEN),
          })
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('blocks POST .../role-assignments (grant a Role) with 409 GROUP_READ_ONLY', async () => {
      const created = await createGroup();
      await setReadOnlyGroup(created.token, created.id);

      const secondUserId = localUserIdByToken.get(SECOND_TOKEN);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/groups/${created.id}/role-assignments`)
        .set('Authorization', `Bearer ${created.token}`)
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
      const created = await createGroup();
      const granted = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );
      await setReadOnlyGroup(created.token, created.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${created.id}/role-assignments/${granted.id}`)
          .set('Authorization', `Bearer ${created.token}`)
          .expect(409),
      );
      expect(response.code).toBe('GROUP_READ_ONLY');
    });

    it('does not create, remove, or change any RoleAssignment row across a READ_ONLY -> ACTIVE cycle', async () => {
      const created = await createGroup();
      const granted = await grantGroupRole(
        created.token,
        created.id,
        SECOND_TOKEN,
      );

      await setReadOnlyGroup(created.token, created.id);
      await activateGroup(created.token, created.id);

      const roleAssignments = await getGroupRoleAssignments(
        created.token,
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
