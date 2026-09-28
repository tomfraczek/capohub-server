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
import { AcademyResponseDto } from '../src/groups/dto/academy-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { CohortResponseDto } from '../src/groups/dto/cohort-response.dto';
import { Academy } from '../src/groups/entities/academy.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Cohort } from '../src/groups/entities/cohort.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

// No fixed "OWNER_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user, and this file needs many
// independent Groups, so createGroup() mints a fresh, throwaway owner per
// call instead (see its own comment).
const ADMIN_TOKEN = 'valid-hierarchy-admin-token';
const MEMBER_TOKEN = 'valid-hierarchy-member-token';
const OUTSIDER_TOKEN = 'valid-hierarchy-outsider-token';

const ADMIN_CLERK_ID = 'user_test_hierarchy_admin';
const MEMBER_CLERK_ID = 'user_test_hierarchy_member';
const OUTSIDER_CLERK_ID = 'user_test_hierarchy_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_hierarchy_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_hierarchy_admin' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_hierarchy_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_hierarchy_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_hierarchy_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_hierarchy_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [ADMIN_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/hierarchy-admin.png',
    primaryEmailAddress: { emailAddress: 'hierarchy.admin@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/hierarchy-member.png',
    primaryEmailAddress: { emailAddress: 'hierarchy.member@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/hierarchy-outsider.png',
    primaryEmailAddress: { emailAddress: 'hierarchy.outsider@example.com' },
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

describe('Group Hierarchy / Academies / Cohorts (e2e)', () => {
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
      await cleanup.nativeDelete(Academy, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(Cohort, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      // Sections must be removed before their parent Groups to satisfy the
      // parent_group_id foreign key (no cascade - see section.entity.ts).
      await cleanup.nativeDelete(Section, { id: { $in: createdGroupIds } });
      // Children Groups must be nulled/removed before their parents to
      // satisfy the parent_group_id self-FK (no cascade - see group.entity.ts).
      await cleanup.nativeUpdate(
        Group,
        { id: { $in: createdGroupIds } },
        { parentGroup: null },
      );
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below (see
      // user-profile.e2e-spec.ts's identical cleanup step).
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // FIXTURE_CLERK_PROFILES, not the old frozen TEST_CLERK_USER_IDS
      // snapshot - createGroup (via createFreshGroupOwner) registers a
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
      name: 'Capoeira Brasil',
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
      namePrefix: 'grp-hier',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Capoeira Brasil Poland',
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
      // Required on Section, same as Group - see create-section.schema.ts.
      country: 'PL',
      city: 'Warsaw',
      region: 'Mazovia',
      geonameId: 756135,
      ...overrides,
    };
  }

  // A Section can only ever be created under a Group (never under another
  // Section - a Section can never have children, see the
  // organizational-domain rebuild, stage 1). `parentId` (the URL param) is
  // always a Group id, never a body field.
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
    createdGroupIds.push(created.id);
    return created;
  }

  // Group has no membership/MEMBER role at all (see the Membership/
  // RoleAssignments rebuild) - the only Roles it ever grants are
  // OWNER/ADMIN, via a direct RoleAssignment.
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

  describe('hierarchy: create', () => {
    it('creates a Group as a root-level entity', async () => {
      const root = await createGroup({ name: 'World HQ' });

      // A Group may itself have a parent Group (organizational-domain
      // rebuild, stage 1) - `parentGroupId` reflects its actual position
      // in the hierarchy, null here since nothing attached it to a parent.
      expect(root.parentGroupId).toBeNull();
      expect(root).not.toHaveProperty('parentId');
    });

    it('creates a Section under a Group with parentGroupId set', async () => {
      const root = await createGroup({ name: 'Capoeira Brasil' });

      const section = await createSection(root.token, root.id, {
        name: 'Capoeira Brasil Poland',
      });

      expect(section.parentGroupId).toBe(root.id);
    });

    // Groups may nest arbitrarily deep (Group -> Group -> ...) and each
    // Group may hold any number of direct Sections - but a Section can
    // never have children of its own (organizational-domain rebuild, stage
    // 1). This supersedes the old "Sections nest under Sections"
    // behavior.
    it('supports multi-level Group hierarchy and lists direct child Groups/Sections separately', async () => {
      const root = await createGroup({ name: 'Brasil' });
      const poland = await createSection(root.token, root.id, {
        name: 'Poland',
      });

      expect(poland.parentGroupId).toBe(root.id);

      const rootSections = await bodyOf<SectionResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/sections`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(rootSections.map((section) => section.id)).toEqual([poland.id]);
    });

    // The Public-view fallback (RoleAssignmentsService.resolvePublicView)
    // covers GROUP_VIEW and SECTION_VIEW (see PUBLIC_VIEW_SAFE_PERMISSIONS'
    // own comment) - SectionsService.list() itself is what keeps a Private
    // child Section from leaking through that list to a stranger, since
    // the permission alone can't express it: an outsider sees the Public
    // child but not the Private one, while the real OWNER still sees both.
    it("narrows a Public Group's child Sections list to Public ones only for an outsider with zero Role Assignment", async () => {
      const root = await createGroup({
        name: 'Mixed Visibility Root',
        isPublic: true,
      });
      const publicChild = await createSection(root.token, root.id, {
        name: 'Public Child',
        isPublic: true,
      });
      const privateChild = await createSection(root.token, root.id, {
        name: 'Private Child',
        isPublic: false,
      });

      const outsiderView = await bodyOf<SectionResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/sections`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(200),
      );
      expect(outsiderView.map((section) => section.id)).toEqual([
        publicChild.id,
      ]);

      const ownerView = await bodyOf<SectionResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/sections`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(ownerView.map((section) => section.id).sort()).toEqual(
        [publicChild.id, privateChild.id].sort(),
      );
    });

    it('rejects creating a Section under another Section - a Section can never have children', async () => {
      const root = await createGroup({
        name: 'No Nested Sections Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Leaf Section',
      });

      // The old dual-mounted 'sections/:sectionId/sections' route no
      // longer exists at all - this path simply doesn't match any route.
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(sectionPayload({ name: 'Would-be grandchild' }))
        .expect(404);
    });

    it('rejects creating a Section under a parent the caller cannot edit (non-member)', async () => {
      const root = await createGroup({ name: 'Private Org' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send(sectionPayload({ name: 'Sneaky Section' }))
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });

    // Group only ever grants OWNER/ADMIN (no MEMBER at all - see the
    // Membership/RoleAssignments rebuild), so the weakest possible
    // authorization for a Group is "no RoleAssignment at all", already
    // covered by the 404/non-member case above. This proves the
    // SECTION_CREATE permission check is keyed off the actual Role (ADMIN
    // has it, same as OWNER), not merely "some RoleAssignment exists".
    it('allows a Group ADMIN (not just OWNER) to create a Section', async () => {
      const root = await createGroup({ name: 'Admin Create Org' });
      await grantGroupRole(root.token, root.id, ADMIN_TOKEN, GroupRole.ADMIN);

      const section = await createSection(ADMIN_TOKEN, root.id, {
        name: 'Admin-created Section',
      });

      expect(section.parentGroupId).toBe(root.id);
    });

    it('rejects creating a Section under a non-existent parent', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/groups/00000000-0000-0000-0000-000000000000/sections')
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send(sectionPayload({ name: 'Orphan' }))
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });

    // Regression coverage for the "every Section must have a country and a
    // city" business rule (see create-section.schema.ts).
    it('rejects creating a Section with no country', async () => {
      const root = await createGroup({
        name: 'Country City Root',
      });
      const input = sectionPayload({ name: 'No Country Section' });
      delete (input as { country?: unknown }).country;

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(input)
        .expect(400);
      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('rejects creating a Section with no city', async () => {
      const root = await createGroup({
        name: 'Country City Root 2',
      });
      const input = sectionPayload({ name: 'No City Section' });
      delete (input as { city?: unknown }).city;

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(input)
        .expect(400);
      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('rejects creating a Section with an empty-string country or city', async () => {
      const root = await createGroup({
        name: 'Country City Root 3',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(sectionPayload({ name: 'Empty Country', country: '' }))
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(sectionPayload({ name: 'Empty City', city: '' }))
        .expect(400);
    });

    it('rejects creating a Section whose city does not belong to its country', async () => {
      const root = await createGroup({
        name: 'Country City Root 4',
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(
          sectionPayload({
            name: 'Mismatched Section',
            country: 'FR',
            city: 'Warsaw',
          }),
        )
        .expect(400);
      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('rejects a Section edit that would leave city empty', async () => {
      const root = await createGroup({
        name: 'Country City Root 5',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Editable Section',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(sectionPayload({ name: 'Editable Section', city: '' }))
        .expect(400);
    });

    it('rejects creating a Section with no geonameId', async () => {
      const root = await createGroup({
        name: 'No Geoname Section Root',
      });
      const input = sectionPayload({ name: 'No Geoname Section' });
      delete (input as { geonameId?: unknown }).geonameId;

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(input)
        .expect(400);
      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );
    });

    // Regression coverage for the city-identification problem: Poland has
    // two different towns both named "Piaski", in different regions, each
    // with its own stable geonameId - see groups.e2e-spec.ts for the
    // identical scenario against a Group.
    it('rejects creating a Section whose geonameId does not match its own city/region', async () => {
      const root = await createGroup({
        name: 'Ambiguous Section Root',
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(
          sectionPayload({
            name: 'Ambiguous Section',
            city: 'Piaski',
            region: 'Lublin',
            geonameId: 3089217, // the *other* Piaski's geonameId
          }),
        )
        .expect(400);
      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('creates a Section with an ambiguous city name given its own correct geonameId, and reconstructs it identically on reopen', async () => {
      const root = await createGroup({
        name: 'Ambiguous Section Root 2',
      });

      const section = await createSection(root.token, root.id, {
        name: 'Disambiguated Section',
        city: 'Piaski',
        region: 'Lublin',
        geonameId: 762390,
      });
      expect(section.city).toBe('Piaski');
      expect(section.region).toBe('Lublin');
      expect(section.geonameId).toBe(762390);

      const fetched = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(fetched.city).toBe('Piaski');
      expect(fetched.region).toBe('Lublin');
      expect(fetched.geonameId).toBe(762390);
    });
  });

  describe('hierarchy: immutability', () => {
    // GroupHierarchyService.attachSection/detachSection are now exposed as
    // public endpoints (see hierarchy-management.service.ts /
    // section.controller.ts) - a Section's parentGroupId can be changed via
    // POST /sections/:id/parent by an actor holding HIERARCHY_MANAGE on
    // both the Section and the new parent Group. Dedicated coverage for
    // attach/move/detach/invitations lives in hierarchy.e2e-spec.ts; this
    // is kept here only as a smoke check that the field genuinely persists
    // through GET after a successful move.
    it("moves a Section's parentGroupId via POST /sections/:id/parent", async () => {
      const root = await createGroup({ name: 'Immutable Root' });
      const section = await createSection(root.token, root.id, {
        name: 'Immutable Section',
      });
      const otherRoot = await createGroup({
        name: 'Immutable Other Root',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${root.token}`)
        .send({ parentGroupId: otherRoot.id })
        .expect(201);

      const fetched = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(fetched.parentGroupId).toBe(otherRoot.id);
    });

    it('rejects an unknown field on a Group update with 400 instead of silently ignoring it', async () => {
      const root = await createGroup({ name: 'Update Root' });
      const otherRoot = await createGroup({
        name: 'Update Other Root',
      });

      // parentGroupId is not just unrecognized - it never existed on
      // updateGroupSchema (see create-group.schema.ts) - but any unknown
      // field is rejected the same way by .strict() (update-group.schema.ts).
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/groups/${root.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(
          groupPayload({
            name: 'Update Root Renamed',
            parentGroupId: otherRoot.id,
          }),
        )
        .expect(400);

      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );

      const fetched = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(fetched.name).toBe('Update Root');
    });

    it('rejects an unknown field on a Section update with 400 instead of silently ignoring it', async () => {
      const root = await createGroup({
        name: 'Section Update Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Section Update Child',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .send(
          sectionPayload({
            name: 'Section Update Child Renamed',
            parentId: root.id,
          }),
        )
        .expect(400);

      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );

      const fetched = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(fetched.name).toBe('Section Update Child');
    });
  });

  // Core Phase 2 invariant: a Group and a Section are the same underlying
  // row, but are only ever reachable through their own route family - see
  // decorators/require-group-kind.decorator.ts.
  describe('kind guard: Group vs Section routes', () => {
    it('a Section is not reachable via GET /groups/:id (404)', async () => {
      const root = await createGroup({
        name: 'Kind Guard Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Kind Guard Section',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/groups/${section.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });

    it('a Group is not reachable via GET /sections/:id (404)', async () => {
      const root = await createGroup({
        name: 'Kind Guard Root Two',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sections/${root.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('academies', () => {
    async function createAcademy(
      token: string,
      groupId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<AcademyResponseDto> {
      return bodyOf<AcademyResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${groupId}/academies`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'City Center',
            address: null,
            latitude: null,
            longitude: null,
            contactEmail: null,
            contactPhone: null,
            openingHours: null,
            photoUrls: null,
            description: null,
            ...overrides,
          })
          .expect(201),
      );
    }

    it('creates, lists, gets, updates and archives an academy', async () => {
      const group = await createGroup({
        name: 'Academy Owner Group',
      });

      const created = await createAcademy(group.token, group.id, {
        name: 'Grunwald',
        latitude: 52.40371,
        longitude: 16.90197,
      });
      expect(created.groupId).toBe(group.id);
      expect(created.status).toBe('ACTIVE');

      const list = await bodyOf<AcademyResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/academies`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(200),
      );
      expect(list.map((academy) => academy.id)).toContain(created.id);

      const fetched = await bodyOf<AcademyResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/academies/${created.id}`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(200),
      );
      expect(fetched.name).toBe('Grunwald');

      const updated = await bodyOf<AcademyResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/academies/${created.id}`)
          .set('Authorization', `Bearer ${group.token}`)
          .send({
            name: 'Grunwald Renamed',
            address: null,
            latitude: null,
            longitude: null,
            contactEmail: null,
            contactPhone: null,
            openingHours: null,
            photoUrls: null,
            description: null,
          })
          .expect(200),
      );
      expect(updated.name).toBe('Grunwald Renamed');

      const archived = await bodyOf<AcademyResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/academies/${created.id}/archive`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(201),
      );
      expect(archived.status).toBe('ARCHIVED');

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/groups/${group.id}/academies/${created.id}`)
        .set('Authorization', `Bearer ${group.token}`)
        .send({
          name: 'Should Fail',
          address: null,
          latitude: null,
          longitude: null,
          contactEmail: null,
          contactPhone: null,
          openingHours: null,
          photoUrls: null,
          description: null,
        })
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'ACADEMY_ARCHIVED',
      );
    });

    it('returns ACADEMY_NOT_FOUND for an unknown academy id', async () => {
      const group = await createGroup({
        name: 'Academy 404 Group',
      });

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/groups/${group.id}/academies/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${group.token}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe(
        'ACADEMY_NOT_FOUND',
      );
    });

    it('rejects a non-member from listing academies', async () => {
      const group = await createGroup({
        name: 'Academy Private Group',
      });

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${group.id}/academies`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });
  });

  describe('cohorts', () => {
    it('creates, lists, gets, updates and archives a cohort, and a group works with zero cohorts', async () => {
      const group = await createGroup({
        name: 'Cohort Owner Group',
      });

      const noCohorts = await bodyOf<CohortResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(200),
      );
      expect(noCohorts).toEqual([]);

      const kids = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${group.token}`)
          .send({ name: 'Kids', description: null })
          .expect(201),
      );
      const adults = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${group.token}`)
          .send({ name: 'Adults', description: null })
          .expect(201),
      );

      const list = await bodyOf<CohortResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(200),
      );
      expect(list.map((cohort) => cohort.id).sort()).toEqual(
        [kids.id, adults.id].sort(),
      );

      const updated = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/cohorts/${kids.id}`)
          .set('Authorization', `Bearer ${group.token}`)
          .send({ name: 'Kids Renamed', description: 'For the little ones' })
          .expect(200),
      );
      expect(updated.name).toBe('Kids Renamed');
      expect(updated.description).toBe('For the little ones');

      const archived = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/cohorts/${kids.id}/archive`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(201),
      );
      expect(archived.status).toBe('ARCHIVED');

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/cohorts/${kids.id}/archive`)
        .set('Authorization', `Bearer ${group.token}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe('COHORT_ARCHIVED');
    });

    it('returns COHORT_NOT_FOUND for an unknown cohort id', async () => {
      const group = await createGroup({
        name: 'Cohort 404 Group',
      });

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/groups/${group.id}/cohorts/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${group.token}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe(
        'COHORT_NOT_FOUND',
      );
    });
  });
});
