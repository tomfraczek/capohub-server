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
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
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
      await cleanup.nativeDelete(Group, {
        id: { $in: createdGroupOrSectionIds },
      });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
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
    createdGroupOrSectionIds.push(created.id);
    return created;
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

  describe('direct attach: Group <-> Group and Group <-> Section', () => {
    it('attaches a standalone Group as a child of another Group', async () => {
      const parent = await createGroup(TOKEN_A, { name: 'Attach Parent A' });
      const child = await createGroup(TOKEN_A, { name: 'Attach Child A' });

      const attached = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/parent`)
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
        { id: child.id, type: 'GROUP', name: child.name },
      ]);
    });

    it('attaches a standalone Section under a Group', async () => {
      const parent = await createGroup(TOKEN_A, {
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

    it('a Group can contain both child Groups and Sections at the same time', async () => {
      const parent = await createGroup(TOKEN_A, { name: 'Mixed Parent' });
      const childGroup = await createGroup(TOKEN_A, {
        name: 'Mixed Child Group',
      });
      const childSection = await createSection(TOKEN_A, parent.id, {
        name: 'Mixed Child Section',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${childGroup.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(201);

      const children = await bodyOf<HierarchyEntityRefDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${parent.id}/children`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(new Set(children.map((c) => c.id))).toEqual(
        new Set([childGroup.id, childSection.id]),
      );
    });

    it('rejects direct attach when the actor has no rights on the child (owned by someone else)', async () => {
      const parent = await createGroup(TOKEN_A, { name: 'No Rights Parent' });
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
      const orphanGroup = await createGroup(TOKEN_A, { name: 'Orphan Group' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${orphanGroup.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parentSection.id })
        .expect(404);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_PARENT_NOT_FOUND',
      );
    });
  });

  describe('self-parent and cycle guards', () => {
    it('rejects a Group attaching itself as its own parent', async () => {
      const group = await createGroup(TOKEN_A, { name: 'Self Parent Group' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: group.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_SELF_PARENT',
      );
    });

    it('rejects a direct two-node cycle (A -> B, then B -> A)', async () => {
      const a = await createGroup(TOKEN_A, { name: 'Cycle A' });
      const b = await createGroup(TOKEN_A, { name: 'Cycle B' });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${b.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: a.id })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${a.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: b.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_HIERARCHY_CYCLE',
      );
    });

    it('rejects a multi-level cycle (A -> B -> C, then C -> A)', async () => {
      const a = await createGroup(TOKEN_A, { name: 'Multi Cycle A' });
      const b = await createGroup(TOKEN_A, { name: 'Multi Cycle B' });
      const c = await createGroup(TOKEN_A, { name: 'Multi Cycle C' });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${b.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: a.id })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${c.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: b.id })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${a.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: c.id })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_HIERARCHY_CYCLE',
      );
    });

    it('allows re-parenting a Group to an unrelated Group (not a cycle)', async () => {
      const oldParent = await createGroup(TOKEN_A, { name: 'Old Parent' });
      const newParent = await createGroup(TOKEN_A, {
        name: 'New Unrelated Parent',
      });
      const child = await createGroup(TOKEN_A, { name: 'Reparented Child' });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: oldParent.id })
        .expect(201);

      const moved = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${child.id}/parent`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .send({ parentGroupId: newParent.id })
          .expect(201),
      );
      expect(moved.parentGroupId).toBe(newParent.id);
    });
  });

  describe('move and detach', () => {
    it('detaches a Group, making it a root Group again', async () => {
      const parent = await createGroup(TOKEN_A, { name: 'Detach Parent' });
      const child = await createGroup(TOKEN_A, { name: 'Detach Child' });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(201);

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
      const root = await createGroup(TOKEN_A, { name: 'Already Root' });

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/groups/${root.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe('NOT_ATTACHED');
    });

    it('a Group stays a Group and a Section stays a Section after attach and detach', async () => {
      const parent = await createGroup(TOKEN_A, {
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
      const parent = await createGroup(TOKEN_A, {
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
      const parent = await createGroup(TOKEN_A, {
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
      const parent = await createGroup(TOKEN_A, { name: 'Invite Parent' });
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
      const parent = await createGroup(TOKEN_A, { name: 'Dup Invite Parent' });
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
      const parent = await createGroup(TOKEN_A, { name: 'Accept Parent' });
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
      const parent = await createGroup(TOKEN_A, { name: 'Race Parent' });
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
      const parent = await createGroup(TOKEN_A, {
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
      const parent = await createGroup(TOKEN_A, { name: 'IDOR Parent' });
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
      const parent = await createGroup(TOKEN_A, { name: 'Reject Parent' });
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
      const parent = await createGroup(TOKEN_A, { name: 'Cancel Parent' });
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

  describe('breadcrumbs and parent chain', () => {
    it('returns deterministic root-first breadcrumbs for a multi-level Group -> Group -> Section chain', async () => {
      const brasil = await createGroup(TOKEN_A, { name: 'Breadcrumb Brasil' });
      const poland = await createGroup(TOKEN_A, { name: 'Breadcrumb Poland' });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${poland.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: brasil.id })
        .expect(201);
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
        { id: brasil.id, type: 'GROUP', name: brasil.name },
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
        { id: brasil.id, type: 'GROUP', name: brasil.name },
        { id: poland.id, type: 'GROUP', name: poland.name },
      ]);
    });

    it('returns a single-item breadcrumb and null parent for a standalone entity', async () => {
      const standalone = await createGroup(TOKEN_A, { name: 'Lonely Root' });

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
    it('logs attach/detach under the exact parent Group, and invitations under the exact parent Group too - never a resolved root', async () => {
      const grandparent = await createGroup(TOKEN_A, {
        name: 'Audit Grandparent',
      });
      const parent = await createGroup(TOKEN_A, { name: 'Audit Parent' });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${parent.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: grandparent.id })
        .expect(201);

      const child = await createGroup(TOKEN_A, { name: 'Audit Child' });
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/parent`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ parentGroupId: parent.id })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${child.id}/parent`)
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

      // The grandparent's own audit log must NOT contain the child-of-parent
      // attach/detach entries - those belong to the exact parent, never a
      // resolved root.
      const grandparentLog = await bodyOf<
        PaginatedResponse<AuditLogEntryResponseDto>
      >(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${grandparent.id}/audit-log`)
          .set('Authorization', `Bearer ${TOKEN_A}`)
          .expect(200),
      );
      expect(
        grandparentLog.data.some(
          (entry) =>
            (entry.action === AuditAction.ATTACH_CHILD ||
              entry.action === AuditAction.DETACH_CHILD) &&
            entry.target?.id === child.id,
        ),
      ).toBe(false);
    });
  });
});
