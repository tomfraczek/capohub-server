/**
 * Targeted e2e coverage for the Group/Section hierarchy (attach/detach/move)
 * and HierarchyInvitation flow (invite/accept/reject/cancel) - see
 * hierarchy-management.service.ts, group-hierarchy.service.ts,
 * hierarchy-invitation.entity.ts.
 *
 * Run in isolation (never as part of the full test:e2e suite):
 *   npx jest --config ./test/jest-e2e.json test/hierarchy.e2e-spec.ts
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
import {
  createFreshGroupOwner,
  forceGroupOwnerForFixture,
} from './fresh-group-owner.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { HierarchyInvitation } from '../src/groups/entities/hierarchy-invitation.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Section } from '../src/groups/entities/section.entity';
import { AuditLogEntryResponseDto } from '../src/groups/dto/audit-log-entry-response.dto';
import { AuditAction } from '../src/groups/enums/audit-action.enum';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { HierarchyInvitationResponseDto } from '../src/groups/dto/hierarchy-invitation-response.dto';
import { HierarchyEntityRefDto } from '../src/groups/dto/hierarchy-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { SectionMembershipResponseDto } from '../src/groups/dto/section-membership-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { PaginatedResponse } from '../src/common/pagination/pagination.types';

const TOKEN_A = 'valid-hier-invite-actor-a-token';
const TOKEN_B = 'valid-hier-invite-actor-b-token';
const TOKEN_OUTSIDER = 'valid-hier-invite-outsider-token';

const CLERK_A = 'user_test_hier_invite_a';
const CLERK_B = 'user_test_hier_invite_b';
const CLERK_OUTSIDER = 'user_test_hier_invite_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [TOKEN_A]: {
    userId: CLERK_A,
    sessionId: 'sess_hier_invite_a',
    tokenType: 'session_token',
    claims: { sub: CLERK_A, sid: 'sess_hier_invite_a' },
  },
  [TOKEN_B]: {
    userId: CLERK_B,
    sessionId: 'sess_hier_invite_b',
    tokenType: 'session_token',
    claims: { sub: CLERK_B, sid: 'sess_hier_invite_b' },
  },
  [TOKEN_OUTSIDER]: {
    userId: CLERK_OUTSIDER,
    sessionId: 'sess_hier_invite_outsider',
    tokenType: 'session_token',
    claims: { sub: CLERK_OUTSIDER, sid: 'sess_hier_invite_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [CLERK_A]: {
    imageUrl: 'https://img.clerk.com/hier-invite-a.png',
    primaryEmailAddress: { emailAddress: 'hier.invite.a@example.com' },
  },
  [CLERK_B]: {
    imageUrl: 'https://img.clerk.com/hier-invite-b.png',
    primaryEmailAddress: { emailAddress: 'hier.invite.b@example.com' },
  },
  [CLERK_OUTSIDER]: {
    imageUrl: 'https://img.clerk.com/hier-invite-outsider.png',
    primaryEmailAddress: { emailAddress: 'hier.invite.outsider@example.com' },
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

// Nest's Express adapter sends an empty response body for a handler that
// returns `null` (treated the same as `undefined` - "nothing to send"),
// never the literal JSON text "null" - and supertest/superagent's `res.body`
// falls back to `{}` for an empty/unparsed body (a well-known superagent
// quirk), so neither can be asserted `.toBeNull()`/`.toEqual(null)` directly.
// `res.text === ''` is the actual, correct wire-level signal here.
async function expectNullBody(req: request.Test): Promise<void> {
  const res = await req;
  expect(res.text).toBe('');
}

describe('Group/Section Hierarchy + Hierarchy Invitations (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupOrSectionIds: string[] = [];
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
      await cleanup.nativeDelete(HierarchyInvitation, {
        $or: [
          { parentGroup: { $in: createdGroupOrSectionIds } },
          { targetGroup: { $in: createdGroupOrSectionIds } },
          { targetSection: { $in: createdGroupOrSectionIds } },
        ],
      });
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: createdGroupOrSectionIds } },
          { section: { $in: createdGroupOrSectionIds } },
        ],
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupOrSectionIds } },
          { section: { $in: createdGroupOrSectionIds } },
        ],
      });
      await cleanup.nativeDelete(Section, {
        id: { $in: createdGroupOrSectionIds },
      });
      await cleanup.nativeUpdate(
        Group,
        { id: { $in: createdGroupOrSectionIds } },
        { parentGroup: null },
      );
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below (see
      // user-profile.e2e-spec.ts's identical cleanup step).
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupOrSectionIds },
      });
      await cleanup.nativeDelete(Group, {
        id: { $in: createdGroupOrSectionIds },
      });
      // FIXTURE_CLERK_PROFILES, not a frozen snapshot - createGroupOwnedByA
      // (via createFreshGroupOwner) registers a fresh fixture user per
      // call, mutating FIXTURE_CLERK_PROFILES in place, so it must be read
      // fresh here to catch every one of them.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Hierarchy Test Group',
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
    createdGroupOrSectionIds.push(created.id);
    return created;
  }

  // The direct-attach/cycle/move/breadcrumb/audit-log tests below need
  // TOKEN_A to hold real OWNER authority on *several* Group nodes at once
  // within a single test (HIERARCHY_MANAGE - see
  // hierarchy-management.service.ts's assertHierarchyManage - is granted to
  // OWNER only, and is required on *both* the child and the parent to
  // attach/move/detach). TOKEN_A itself can no longer call createGroup()
  // more than once (GroupsService.create now allows at most one active
  // FormalGroupAffiliation per user - see USER_ALREADY_HAS_FORMAL_GROUP),
  // and TOKEN_A is reused across every `it()` in this whole file, so even
  // its *first* createGroup(TOKEN_A, ...) call in file order would leave
  // every later one 409ing.
  //
  // Fix: a throwaway fixture user creates the Group for real (their own,
  // genuine FormalGroupAffiliation - never TOKEN_A's), grants TOKEN_A
  // ADMIN, then makes TOKEN_A the OWNER directly in the DB
  // (forceGroupOwnerForFixture - the API transfer refuses a target that
  // already owns a Group) -
  // TOKEN_A ends up the real OWNER (and thus HIERARCHY_MANAGE holder) of
  // as many Groups as a test needs, without ever spending its own
  // one-per-user formal-group slot on any of them. `founderUser` stays the
  // throwaway user (permanent, never reassigned by transferOwnership) - no
  // test in this file asserts founderUser, so that's inert here.
  async function createGroupOwnedByA(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const fresh = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      namePrefix: 'hier-a-owned',
      onGroupCreated: (id) => createdGroupOrSectionIds.push(id),
      groupOverrides: groupPayload(overrides),
    });
    const actorAUserId = localUserIdByToken.get(TOKEN_A);

    await request(app.getHttpServer())
      .post(`/api/v1/groups/${fresh.group.id}/role-assignments`)
      .set('Authorization', `Bearer ${fresh.token}`)
      .send({ userId: actorAUserId, role: 'ADMIN' })
      .expect(201);

    // Not POST .../transfer-ownership: TOKEN_A owning several Groups is
    // exactly what the real transfer now refuses (TARGET_ALREADY_OWNS_GROUP)
    // - see forceGroupOwnerForFixture.
    await forceGroupOwnerForFixture(app, fresh.group.id, actorAUserId!);

    return fresh.group;
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Hierarchy Test Section',
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
      city: 'Warsaw',
      region: 'Mazovia',
      geonameId: 756135,
      ...overrides,
    };
  }

  async function createSection(
    token: string,
    parentGroupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupOrSectionIds.push(created.id);
    return created;
  }

  // Writes `parentGroup` straight to the DB, bypassing every service rule -
  // only for simulating rows the API itself can no longer produce (a legacy
  // Group -> Group link, or a Section that got a Group by some other path
  // while an invitation was still PENDING).
  async function setParentGroupDirectly(
    entity: typeof Group | typeof Section,
    id: string,
    parentGroupId: string | null,
  ): Promise<void> {
    await app
      .get(EntityManager)
      .fork()
      .nativeUpdate(entity, { id }, { parentGroup: parentGroupId });
  }

  async function invite(
    parentGroupId: string,
    sectionId: string,
  ): Promise<HierarchyInvitationResponseDto> {
    return bodyOf<HierarchyInvitationResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/child-invitations`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ targetType: 'SECTION', targetId: sectionId })
        .expect(201),
    );
  }

  async function sectionParentId(sectionId: string): Promise<string | null> {
    const section = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/sections/${sectionId}`)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(200),
    );
    return section.parentGroupId;
  }

  async function invitationStatus(invitationId: string): Promise<string> {
    const invitation = await app
      .get(EntityManager)
      .fork()
      .findOneOrFail(HierarchyInvitation, { id: invitationId });
    return invitation.status;
  }

  // Creates a standalone Section (no parent) directly via POST /sections -
  // see ADR-032. Dedicated coverage for that endpoint itself lives in
  // standalone-sections.e2e-spec.ts; this helper exists so every hierarchy
  // test below (attach/detach/invitations/no-inheritance) gets a real
  // parentless Section to work with, exactly as a caller would create one.
  async function createStandaloneSection(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/sections')
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupOrSectionIds.push(created.id);
    return created;
  }

  describe('direct attach: Group -> Section only', () => {
    it('rejects attaching a Group under another Group - Groups are always top-level', async () => {
      const parent = await createGroupOwnedByA({ name: 'Attach Parent A' });
      const child = await createGroupOwnedByA({ name: 'Attach Child A' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_CANNOT_HAVE_PARENT',
      );

      const children = await bodyOf<HierarchyEntityRefDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${parent.id}/children`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(children).toEqual([]);
    });

    it('attaches a standalone Section under a Group', async () => {
      const parent = await createGroupOwnedByA({
        name: 'Attach Section Parent',
      });
      const section = await createStandaloneSection(TOKEN_A, {
        name: 'Attach Section Child',
      });

      const attached = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/parent`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ parentGroupId: parent.id })
          .expect(201),
      );
      expect(attached.parentGroupId).toBe(parent.id);

      const children = await bodyOf<HierarchyEntityRefDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${parent.id}/children`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(children).toEqual([
        { id: section.id, type: 'SECTION', name: section.name },
      ]);
    });

    it('a Group can contain several Sections at the same time', async () => {
      const parent = await createGroupOwnedByA({ name: 'Mixed Parent' });
      const first = await createSection(TOKEN_A, parent.id, {
        name: 'Mixed Child Section 1',
      });
      const second = await createSection(TOKEN_A, parent.id, {
        name: 'Mixed Child Section 2',
      });

      const children = await bodyOf<HierarchyEntityRefDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${parent.id}/children`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(new Set(children.map((c) => c.id))).toEqual(
        new Set([first.id, second.id]),
      );
    });

    it('rejects direct attach when the actor has no rights on the child (owned by someone else)', async () => {
      const parent = await createGroupOwnedByA({ name: 'No Rights Parent' });
      const foreignSection = await createStandaloneSection(TOKEN_B, {
        name: 'Foreign Section',
      });

      // GroupPermissionsGuard hides existence uniformly behind one generic
      // 404 code regardless of whether the route id is a Group or a Section
      // (see GroupPermissionsGuard.groupNotFound - a caller with no usable
      // authorization for an id must never learn from the error code alone
      // whether it belongs to a Group or a Section).
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sections/${foreignSection.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(404);
      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');

      const fetched = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${foreignSection.id}`)
          .set('Authorization', `Bearer ${TOKEN_B}`)
          .expect(200),
      );
      expect(fetched.parentGroupId).toBeNull();
    });

    it('rejects attaching anything under a Section - a Section can never have children', async () => {
      const parentSection = await createStandaloneSection(TOKEN_A, {
        name: 'Would-be Parent Section',
      });
      const orphanSection = await createStandaloneSection(TOKEN_A, {
        name: 'Orphan Section',
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sections/${orphanSection.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parentSection.id })
        .expect(404);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_PARENT_NOT_FOUND',
      );
    });

    it('rejects a Group attaching itself as its own parent with the same top-level error', async () => {
      const group = await createGroupOwnedByA({ name: 'Self Parent Group' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: group.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_CANNOT_HAVE_PARENT',
      );
    });
  });

  describe('move and detach', () => {
    it('detaches a legacy child Group, making it a root Group again', async () => {
      const parent = await createGroupOwnedByA({ name: 'Detach Parent' });
      const child = await createGroupOwnedByA({ name: 'Detach Child' });
      // Group -> Group links can no longer be created through the API -
      // only legacy rows can carry one, so it is written directly here.
      await setParentGroupDirectly(Group, child.id, parent.id);

      const detached = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${child.id}/parent`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(detached.parentGroupId).toBeNull();

      await expectNullBody(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}/parent`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
    });

    it('rejects detaching a Group that has no parent to begin with', async () => {
      const root = await createGroupOwnedByA({ name: 'Already Root' });

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/groups/${root.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe('NOT_ATTACHED');
    });

    it('a Group stays a Group and a Section stays a Section after attach and detach', async () => {
      const parent = await createGroupOwnedByA({
        name: 'Type Immutability Parent',
      });
      const section = await createStandaloneSection(TOKEN_A, {
        name: 'Type Immutability Section',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(200);

      // Still reachable as a Section, never promoted/demoted to a Group.
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${section.id}`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(404);
    });

    it('never changes SectionMembership or RoleAssignments as a side effect of attach/detach/move', async () => {
      const parent = await createGroupOwnedByA({
        name: 'No Side Effects Parent',
      });
      const section = await createStandaloneSection(TOKEN_A, {
        name: 'No Side Effects Section',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/members`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ userId: localUserIdByToken.get(TOKEN_B) })
        .expect(201);

      const membersBefore = await bodyOf<SectionMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      const rolesBefore = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(200);

      const membersAfter = await bodyOf<SectionMembershipResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/members`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      const rolesAfter = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );

      expect(
        membersAfter.map((m) => ({
          id: m.id,
          status: m.status,
          roles: m.roles,
        })),
      ).toEqual(
        membersBefore.map((m) => ({
          id: m.id,
          status: m.status,
          roles: m.roles,
        })),
      );
      expect(
        rolesAfter.map((r) => ({
          id: r.id,
          role: r.role,
          revokedAt: r.revokedAt,
        })),
      ).toEqual(
        rolesBefore.map((r) => ({
          id: r.id,
          role: r.role,
          revokedAt: r.revokedAt,
        })),
      );
    });
  });

  describe('permission isolation - no inheritance from parent to child', () => {
    it("a parent Group's OWNER cannot detach/move a child Section they do not own themselves (IDOR)", async () => {
      const parent = await createGroupOwnedByA({
        name: 'No Inheritance Parent',
      });
      const childSection = await createStandaloneSection(TOKEN_B, {
        name: 'No Inheritance Child',
      });
      // TOKEN_B (the Section's own OWNER) attaches it under TOKEN_A's Group -
      // TOKEN_B has HIERARCHY_MANAGE on the Section; TOKEN_A must separately
      // grant TOKEN_B... no: TOKEN_B needs HIERARCHY_MANAGE on the *parent*
      // too to attach directly, which they don't have here - use the
      // invitation flow instead, exactly as the domain rules prescribe.
      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: childSection.id })
          .expect(201),
      );
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${childSection.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(204);

      // Now childSection.parentGroupId === parent.id, but TOKEN_A (parent's
      // OWNER) still holds no RoleAssignment at all on childSection - never
      // inherited from owning the parent.
      const detachAttempt = await request(app.getHttpServer())
        .delete(`/api/v1/sections/${childSection.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(404);
      expect((detachAttempt.body as HttpErrorResponse).code).toBe(
        'GROUP_NOT_FOUND',
      );

      // The Section's own OWNER can, though.
      const detached = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/sections/${childSection.id}/parent`)
          .set('Authorization', `Bearer ${TOKEN_B}`)
          .expect(200),
      );
      expect(detached.parentGroupId).toBeNull();
    });
  });

  describe('hierarchy invitations', () => {
    it('creates an invitation for a target the parent-admin does not control, without mutating anything', async () => {
      const parent = await createGroupOwnedByA({ name: 'Invite Parent' });
      const target = await createStandaloneSection(TOKEN_B, {
        name: 'Invite Target',
      });

      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: target.id })
          .expect(201),
      );
      expect(invitation.status).toBe('PENDING');
      expect(invitation.parentGroup).toEqual({
        id: parent.id,
        type: 'GROUP',
        name: parent.name,
      });
      expect(invitation.target).toEqual({
        id: target.id,
        type: 'SECTION',
        name: target.name,
      });

      const fetchedTarget = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${target.id}`)
          .set('Authorization', `Bearer ${TOKEN_B}`)
          .expect(200),
      );
      expect(fetchedTarget.parentGroupId).toBeNull();
    });

    it('rejects a duplicate pending invitation for the same relation', async () => {
      const parent = await createGroupOwnedByA({ name: 'Dup Invite Parent' });
      const target = await createStandaloneSection(TOKEN_B, {
        name: 'Dup Invite Target',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${parent.id}/child-invitations`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ targetType: 'SECTION', targetId: target.id })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${parent.id}/child-invitations`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ targetType: 'SECTION', targetId: target.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'HIERARCHY_INVITATION_ALREADY_PENDING',
      );
    });

    it('accepts an invitation and attaches the target - only the target OWNER may accept', async () => {
      const parent = await createGroupOwnedByA({ name: 'Accept Parent' });
      const target = await createStandaloneSection(TOKEN_B, {
        name: 'Accept Target',
      });
      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: target.id })
          .expect(201),
      );

      // Not the target OWNER - rejected.
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${target.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_OUTSIDER}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${target.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(204);

      const fetched = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${target.id}`)
          .set('Authorization', `Bearer ${TOKEN_B}`)
          .expect(200),
      );
      expect(fetched.parentGroupId).toBe(parent.id);
    });

    it('rejects accepting an already-terminal invitation, and a concurrent double-accept only succeeds once', async () => {
      const parent = await createGroupOwnedByA({ name: 'Race Parent' });
      const target = await createStandaloneSection(TOKEN_B, {
        name: 'Race Target',
      });
      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: target.id })
          .expect(201),
      );

      const acceptUrl = `/api/v1/sections/${target.id}/hierarchy-invitations/${invitation.id}/accept`;
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(acceptUrl)
          .set('Authorization', `Bearer ${TOKEN_B}`),
        request(app.getHttpServer())
          .post(acceptUrl)
          .set('Authorization', `Bearer ${TOKEN_B}`),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([204, 409]);
    });

    it('rejects accepting after the target became archived in the meantime', async () => {
      const parent = await createGroupOwnedByA({
        name: 'Archived Target Parent',
      });
      const target = await createStandaloneSection(TOKEN_B, {
        name: 'Archived Target',
      });
      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: target.id })
          .expect(201),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${target.id}/archive`)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${target.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe('GROUP_ARCHIVED');
    });

    it('rejects accepting an invitation through the wrong target id in the URL (IDOR)', async () => {
      const parent = await createGroupOwnedByA({ name: 'IDOR Parent' });
      const realTarget = await createStandaloneSection(TOKEN_B, {
        name: 'IDOR Real Target',
      });
      const otherOwnedByB = await createGroup(TOKEN_B, {
        name: 'IDOR Other Group Owned By B',
      });
      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: realTarget.id })
          .expect(201),
      );

      // TOKEN_B genuinely owns otherOwnedByB (passes the route guard), but
      // this invitation does not target it - must still be rejected.
      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${otherOwnedByB.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(404);
      expect((response.body as HttpErrorResponse).code).toBe(
        'HIERARCHY_INVITATION_NOT_FOUND',
      );
    });

    it('rejects an invitation - no hierarchy relationship is created', async () => {
      const parent = await createGroupOwnedByA({ name: 'Reject Parent' });
      const target = await createStandaloneSection(TOKEN_B, {
        name: 'Reject Target',
      });
      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: target.id })
          .expect(201),
      );

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${target.id}/hierarchy-invitations/${invitation.id}/reject`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(204);

      const fetched = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${target.id}`)
          .set('Authorization', `Bearer ${TOKEN_B}`)
          .expect(200),
      );
      expect(fetched.parentGroupId).toBeNull();

      // A fresh invitation for the same relation is allowed now that the
      // previous one is terminal.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${parent.id}/child-invitations`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ targetType: 'SECTION', targetId: target.id })
        .expect(201);
    });

    it('cancels a pending invitation from the parent side - no relationship is created', async () => {
      const parent = await createGroupOwnedByA({ name: 'Cancel Parent' });
      const target = await createStandaloneSection(TOKEN_B, {
        name: 'Cancel Target',
      });
      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ targetType: 'SECTION', targetId: target.id })
          .expect(201),
      );

      await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${parent.id}/child-invitations/${invitation.id}/cancel`,
        )
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(204);

      // Cancelling again is rejected - already terminal.
      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${parent.id}/child-invitations/${invitation.id}/cancel`,
        )
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'HIERARCHY_INVITATION_NOT_PENDING',
      );

      // The target OWNER can no longer accept a cancelled invitation.
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${target.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(409);
    });
  });

  describe('a Section belongs to at most one Group', () => {
    it('rejects inviting a Group - only a standalone Section can be invited', async () => {
      const parent = await createGroupOwnedByA({ name: 'Group Target Parent' });
      const target = await createGroupOwnedByA({ name: 'Group Target' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${parent.id}/child-invitations`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ targetType: 'GROUP', targetId: target.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_CANNOT_HAVE_PARENT',
      );
    });

    it('refuses to accept a legacy PENDING invitation addressed to a Group', async () => {
      const parent = await createGroupOwnedByA({ name: 'Legacy Inv Parent' });
      const target = await createGroupOwnedByA({ name: 'Legacy Inv Target' });
      // Can no longer be created through the API - written directly.
      const em = app.get(EntityManager).fork();
      const legacy = new HierarchyInvitation();
      legacy.parentGroup = em.getReference(Group, parent.id);
      legacy.targetGroup = em.getReference(Group, target.id);
      await em.persist(legacy).flush();

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${target.id}/hierarchy-invitations/${legacy.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_CANNOT_HAVE_PARENT',
      );

      await expectNullBody(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${target.id}/parent`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
    });

    it('rejects inviting a Section that already belongs to another Group', async () => {
      const current = await createGroupOwnedByA({ name: 'Current Group' });
      const other = await createGroupOwnedByA({ name: 'Other Group' });
      const section = await createStandaloneSection(TOKEN_B, {
        name: 'Already Attached Section',
      });
      const first = await invite(current.id, section.id);
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/hierarchy-invitations/${first.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${other.id}/child-invitations`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ targetType: 'SECTION', targetId: section.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'SECTION_ALREADY_HAS_PARENT',
      );
    });

    it('rejects accepting an invitation once the Section already has a Group - never re-parents it', async () => {
      const current = await createGroupOwnedByA({ name: 'Holding Group' });
      const inviter = await createGroupOwnedByA({ name: 'Late Inviter' });
      const section = await createStandaloneSection(TOKEN_B, {
        name: 'Raced Section',
      });
      const invitation = await invite(inviter.id, section.id);
      // The Section got a Group by some other path while this invitation
      // was still PENDING (e.g. data written before this rule existed).
      await setParentGroupDirectly(Section, section.id, current.id);

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'SECTION_ALREADY_HAS_PARENT',
      );

      expect(await sectionParentId(section.id)).toBe(current.id);
      expect(await invitationStatus(invitation.id)).toBe('PENDING');
    });

    it('cancels every other PENDING invitation once one is accepted - none can move the Section later', async () => {
      const winner = await createGroupOwnedByA({ name: 'Winner Group' });
      const loserA = await createGroupOwnedByA({ name: 'Loser Group A' });
      const loserB = await createGroupOwnedByA({ name: 'Loser Group B' });
      const section = await createStandaloneSection(TOKEN_B, {
        name: 'Popular Section',
      });
      const accepted = await invite(winner.id, section.id);
      const otherA = await invite(loserA.id, section.id);
      const otherB = await invite(loserB.id, section.id);

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/hierarchy-invitations/${accepted.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(204);

      expect(await invitationStatus(accepted.id)).toBe('ACCEPTED');
      expect(await invitationStatus(otherA.id)).toBe('CANCELLED');
      expect(await invitationStatus(otherB.id)).toBe('CANCELLED');

      const received = await bodyOf<HierarchyInvitationResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/hierarchy-invitations/received`)
          .set('Authorization', `Bearer ${TOKEN_B}`)
          .expect(200),
      );
      expect(received).toEqual([]);

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/hierarchy-invitations/${otherA.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'HIERARCHY_INVITATION_NOT_PENDING',
      );
      expect(await sectionParentId(section.id)).toBe(winner.id);
    });

    it('two different invitations accepted concurrently attach the Section to exactly one Group', async () => {
      const groupX = await createGroupOwnedByA({ name: 'Concurrent X' });
      const groupY = await createGroupOwnedByA({ name: 'Concurrent Y' });
      const section = await createStandaloneSection(TOKEN_B, {
        name: 'Concurrent Section',
      });
      const toX = await invite(groupX.id, section.id);
      const toY = await invite(groupY.id, section.id);

      const [first, second] = await Promise.all(
        [toX, toY].map((invitation) =>
          request(app.getHttpServer())
            .post(
              `/api/v1/sections/${section.id}/hierarchy-invitations/${invitation.id}/accept`,
            )
            .set('Authorization', `Bearer ${TOKEN_B}`),
        ),
      );
      expect([first.status, second.status].sort()).toEqual([204, 409]);

      const winnerId = first.status === 204 ? groupX.id : groupY.id;
      expect(await sectionParentId(section.id)).toBe(winnerId);
    });

    it('a direct move (POST /sections/:id/parent) also cancels pending invitations', async () => {
      const target = await createGroupOwnedByA({ name: 'Direct Move Target' });
      const inviter = await createGroupOwnedByA({
        name: 'Direct Move Inviter',
      });
      const section = await createStandaloneSection(TOKEN_A, {
        name: 'Direct Move Section',
      });
      const pending = await invite(inviter.id, section.id);

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: target.id })
        .expect(201);

      expect(await invitationStatus(pending.id)).toBe('CANCELLED');
    });

    it('after detaching, the Section can receive and accept a new invitation', async () => {
      const first = await createGroupOwnedByA({ name: 'First Home' });
      const second = await createGroupOwnedByA({ name: 'Second Home' });
      const section = await createStandaloneSection(TOKEN_B, {
        name: 'Moving Section',
      });
      const toFirst = await invite(first.id, section.id);
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/hierarchy-invitations/${toFirst.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(200);

      const toSecond = await invite(second.id, section.id);
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/hierarchy-invitations/${toSecond.id}/accept`,
        )
        .set('Authorization', `Bearer ${TOKEN_B}`)
        .expect(204);
      expect(await sectionParentId(section.id)).toBe(second.id);
    });
  });

  describe('breadcrumbs and parent chain', () => {
    it('returns deterministic root-first breadcrumbs for a Group -> Section chain', async () => {
      const poland = await createGroupOwnedByA({ name: 'Breadcrumb Poland' });
      const poznan = await createSection(TOKEN_A, poland.id, {
        name: 'Breadcrumb Poznan',
      });

      const breadcrumbs = await bodyOf<HierarchyEntityRefDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${poznan.id}/breadcrumbs`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(breadcrumbs).toEqual([
        { id: poland.id, type: 'GROUP', name: poland.name },
        { id: poznan.id, type: 'SECTION', name: poznan.name },
      ]);

      const groupBreadcrumbs = await bodyOf<HierarchyEntityRefDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${poland.id}/breadcrumbs`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(groupBreadcrumbs).toEqual([
        { id: poland.id, type: 'GROUP', name: poland.name },
      ]);
    });

    it('returns a single-item breadcrumb and null parent for a standalone entity', async () => {
      const standalone = await createGroupOwnedByA({ name: 'Lonely Root' });

      const breadcrumbs = await bodyOf<HierarchyEntityRefDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${standalone.id}/breadcrumbs`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(breadcrumbs).toEqual([
        { id: standalone.id, type: 'GROUP', name: standalone.name },
      ]);

      await expectNullBody(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${standalone.id}/parent`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
    });
  });

  describe('audit log', () => {
    it('logs attach/detach under the exact parent Group only', async () => {
      const parent = await createGroupOwnedByA({ name: 'Audit Parent' });
      const unrelated = await createGroupOwnedByA({ name: 'Audit Unrelated' });
      const section = await createStandaloneSection(TOKEN_A, {
        name: 'Audit Section',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(200);

      const parentLog = await bodyOf<
        PaginatedResponse<AuditLogEntryResponseDto>
      >(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${parent.id}/audit-log`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      const actions = parentLog.data.map((entry) => entry.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          AuditAction.ATTACH_CHILD,
          AuditAction.DETACH_CHILD,
        ]),
      );
      expect(
        parentLog.data.every((entry) => entry.communityId === parent.id),
      ).toBe(true);

      const unrelatedLog = await bodyOf<
        PaginatedResponse<AuditLogEntryResponseDto>
      >(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${unrelated.id}/audit-log`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(
        unrelatedLog.data.some(
          (entry) =>
            (entry.action === AuditAction.ATTACH_CHILD ||
              entry.action === AuditAction.DETACH_CHILD) &&
            entry.target?.id === section.id,
        ),
      ).toBe(false);
    });
  });
});
