/**
 * E2E tests for standalone Section creation (POST /sections) - see
 * ADR-032. A Section may now exist independently, with no parent Group at
 * all, alongside the pre-existing POST /groups/:groupId/sections (Section
 * created directly under a specific Group - unchanged, see
 * group-hierarchy.e2e-spec.ts / hierarchy.e2e-spec.ts for its own
 * coverage).
 *
 * Covers:
 *  - any authenticated user may create a standalone Section
 *  - the response has parentGroupId === null
 *  - the creator gets the same SectionMembership + MEMBER/OWNER
 *    RoleAssignment bootstrap as Section-under-Group creation
 *  - a user may create several independent standalone Sections, with no
 *    relationship created between them
 *  - a standalone Section shows up correctly in Community Home
 *  - a standalone Section can later be attached to a Group via the
 *    existing hierarchy flow, without inheriting membership/roles from
 *    that Group's OWNER
 *  - unauthenticated requests are rejected
 *  - CreateSectionDto's existing validation rules still apply
 *  - the CREATE_COMMUNITY audit trail is filed under the Section itself
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
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import { resolveDisplayName } from '../src/users/display-name.util';
import { User } from '../src/users/entities/user.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { HierarchyInvitation } from '../src/groups/entities/hierarchy-invitation.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Section } from '../src/groups/entities/section.entity';
import { AuditLogEntryResponseDto } from '../src/groups/dto/audit-log-entry-response.dto';
import { CommunityHomeResponseDto } from '../src/groups/dto/community-home-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { SectionMembershipResponseDto } from '../src/groups/dto/section-membership-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const OWNER_TOKEN = 'valid-standalone-sections-owner-token';
const SECOND_TOKEN = 'valid-standalone-sections-second-token';

const OWNER_CLERK_ID = 'user_test_standalone_sections_owner';
const SECOND_CLERK_ID = 'user_test_standalone_sections_second';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_standalone_sections_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_standalone_sections_owner' },
  },
  [SECOND_TOKEN]: {
    userId: SECOND_CLERK_ID,
    sessionId: 'sess_standalone_sections_second',
    tokenType: 'session_token',
    claims: { sub: SECOND_CLERK_ID, sid: 'sess_standalone_sections_second' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/standalone-sections-owner.png',
    primaryEmailAddress: {
      emailAddress: 'standalone.sections.owner@example.com',
    },
  },
  [SECOND_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/standalone-sections-second.png',
    primaryEmailAddress: {
      emailAddress: 'standalone.sections.second@example.com',
    },
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

describe('Standalone Sections (e2e)', () => {
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
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Independent Capoeira Roda',
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
      // Required on Section, standalone or not - see create-section.schema.ts.
      country: 'PL',
      city: 'Warsaw',
      region: 'Mazovia',
      geonameId: 756135,
      ...overrides,
    };
  }

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

  async function createGroup(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Standalone Sections Test Group',
          isPublic: true,
          isHidden: false,
          memberInvitesAllowed: false,
          timezone: 'Europe/Warsaw',
          currencyCode: 'PLN',
          ...overrides,
        })
        .expect(201),
    );
    createdGroupOrSectionIds.push(created.id);
    return created;
  }

  async function getSectionMembers(
    token: string,
    sectionId: string,
  ): Promise<SectionMembershipResponseDto[]> {
    return bodyOf<SectionMembershipResponseDto[]>(
      request(app.getHttpServer())
        .get(`/api/v1/sections/${sectionId}/members`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function getSectionRoleAssignments(
    token: string,
    sectionId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    return bodyOf<RoleAssignmentResponseDto[]>(
      request(app.getHttpServer())
        .get(`/api/v1/sections/${sectionId}/role-assignments`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  describe('create', () => {
    it('lets any authenticated user create a standalone Section with parentGroupId === null', async () => {
      const created = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Roda Livre',
      });

      expect(created.name).toBe('Roda Livre');
      expect(created.parentGroupId).toBeNull();
      expect(created.status).toBe('ACTIVE');
    });

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/sections')
        .send(sectionPayload())
        .expect(401);
    });

    // Career History audit follow-up: same permanent founder record as
    // Group (see groups.e2e-spec.ts's identical test and
    // section.entity.ts's founderUser comment) - set once here, for both
    // the standalone and under-a-Group creation paths (same
    // SectionsService.createInternal), and never re-derived from
    // RoleAssignment afterwards.
    it('records the creator as founderUser, with a displayName snapshot', async () => {
      const created = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Founder Snapshot Test',
      });

      const em = app.get(EntityManager).fork();
      const section = await em.findOneOrFail(Section, { id: created.id });
      const creator = await em.findOneOrFail(User, {
        id: localUserIdByToken.get(OWNER_TOKEN),
      });

      expect(section.founderUser?.id).toBe(creator.id);
      expect(section.founderNameSnapshot).toBe(resolveDisplayName(creator));
    });

    // Same schema as Section-under-Group (create-section.schema.ts) -
    // country/city/geonameId stay required, exactly as they are there (see
    // create-section.schema.spec.ts for the full validation battery; this
    // is just a smoke check that the standalone endpoint enforces the same
    // schema, not a re-derivation of it).
    it('rejects a standalone Section with no country, same as Section-under-Group', async () => {
      const input = sectionPayload({ name: 'No Country Standalone' });
      delete (input as { country?: unknown }).country;

      const response = await request(app.getHttpServer())
        .post('/api/v1/sections')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(input)
        .expect(400);

      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );
    });

    // createSectionSchema strips unknown keys rather than rejecting them
    // (only updateSectionSchema is .strict() - see create-section.schema.ts's
    // own comment), so a stray parentGroupId in the body is silently
    // dropped rather than honored - the parent is never a body field, on
    // either Section creation route.
    it('silently ignores a parentGroupId sent in the body - the standalone Section stays parentless', async () => {
      const created = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Sneaky Parent Field',
        parentGroupId: '00000000-0000-0000-0000-000000000000',
      });

      expect(created.parentGroupId).toBeNull();
    });

    it('gives the creator the same SectionMembership + MEMBER/OWNER RoleAssignment bootstrap as Section-under-Group creation', async () => {
      const created = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Bootstrap Check Section',
      });
      const ownerUserId = localUserIdByToken.get(OWNER_TOKEN);

      const members = await getSectionMembers(OWNER_TOKEN, created.id);
      expect(members).toHaveLength(1);
      expect(members[0].user.id).toBe(ownerUserId);
      expect(members[0].status).toBe('ACTIVE');
      expect(new Set(members[0].roles)).toEqual(
        new Set([GroupRole.MEMBER, GroupRole.OWNER]),
      );

      const roleAssignments = await getSectionRoleAssignments(
        OWNER_TOKEN,
        created.id,
      );
      expect(roleAssignments).toHaveLength(2);
      expect(new Set(roleAssignments.map((r) => r.role))).toEqual(
        new Set([GroupRole.MEMBER, GroupRole.OWNER]),
      );
      for (const assignment of roleAssignments) {
        expect(assignment.user.id).toBe(ownerUserId);
      }
    });

    it('lets a user create several independent standalone Sections, with no relationship between them', async () => {
      const first = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Independent Section One',
      });
      const second = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Independent Section Two',
      });

      expect(first.id).not.toBe(second.id);
      expect(first.parentGroupId).toBeNull();
      expect(second.parentGroupId).toBeNull();

      // Each is its own single-item breadcrumb chain - neither references
      // the other in any way (see ADR-019, no automatic relationships).
      const firstBreadcrumbs = await bodyOf<{ id: string }[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${first.id}/breadcrumbs`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const secondBreadcrumbs = await bodyOf<{ id: string }[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${second.id}/breadcrumbs`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(firstBreadcrumbs).toEqual([
        { id: first.id, type: 'SECTION', name: first.name },
      ]);
      expect(secondBreadcrumbs).toEqual([
        { id: second.id, type: 'SECTION', name: second.name },
      ]);

      // Membership on one grants nothing on the other.
      const secondMembers = await getSectionMembers(OWNER_TOKEN, second.id);
      expect(secondMembers).toHaveLength(1);
      const firstMembers = await getSectionMembers(OWNER_TOKEN, first.id);
      expect(firstMembers).toHaveLength(1);
    });

    it('creating a standalone Section never creates a Group', async () => {
      const before = await bodyOf<unknown[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(200),
      );

      await createStandaloneSection(SECOND_TOKEN, {
        name: 'No Group Side Effect Section',
      });

      const after = await bodyOf<unknown[]>(
        request(app.getHttpServer())
          .get('/api/v1/groups')
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .expect(200),
      );
      expect(after.length).toBe(before.length);
    });

    it('files the CREATE_COMMUNITY audit entry under the Section itself, never under any Group', async () => {
      const created = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Audited Standalone Section',
      });

      const log = await bodyOf<PaginatedResponse<AuditLogEntryResponseDto>>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${created.id}/audit-log`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(log.data).toHaveLength(1);
      expect(log.data[0].action).toBe('CREATE_COMMUNITY');
      expect(log.data[0].communityId).toBe(created.id);
    });
  });

  describe('Community Home', () => {
    it('shows a standalone Section in myCommunities, typed as a Section and grouped under itself', async () => {
      const created = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Community Home Standalone Section',
      });

      const home = await bodyOf<CommunityHomeResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/community/home')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      const entry = home.myCommunities.find((c) => c.id === created.id);
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({
        isGroup: false,
        parentId: null,
        // No parent Group to resolve a root for - grouped under itself
        // (see CommunityHomeService.resolveRootGroupId).
        rootGroupId: created.id,
      });
      expect(new Set(entry?.myRoles)).toEqual(
        new Set([GroupRole.MEMBER, GroupRole.OWNER]),
      );
      expect(home.capabilities.canCreateStandaloneSection).toBe(true);
    });
  });

  describe('attaching a standalone Section to a Group later', () => {
    it('same-owner direct attach via POST /sections/:id/parent works exactly like Section-under-Group hierarchy', async () => {
      const section = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Attach-Later Section (same owner)',
      });
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Attach-Later Group (same owner)',
      });

      const attached = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/parent`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ parentGroupId: group.id })
          .expect(201),
      );
      expect(attached.parentGroupId).toBe(group.id);
    });

    it('attaches via the hierarchy invitation flow (different owners) without inheriting membership/roles from the Group OWNER', async () => {
      // Private - this test's 404 assertions below are about permission
      // isolation (no Role Assignment inheritance from the Group), not
      // about the Public-view fallback (RoleAssignmentsService.
      // resolvePublicView), which would otherwise let SECOND_TOKEN read a
      // Public Section's GET even with zero Role Assignments.
      const section = await createStandaloneSection(OWNER_TOKEN, {
        name: 'Attach-Later Section (invitation)',
        isPublic: false,
      });
      // A different user owns the Group - proves attach never grants that
      // Group's OWNER any right over the Section (no permission
      // inheritance - see ADR-013/ADR-024).
      const group = await createGroup(SECOND_TOKEN, {
        name: 'Attach-Later Group (invitation)',
      });

      // The Group OWNER cannot act on the Section before attaching...
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(404);

      // ...so a direct attach by whoever controls only one side is
      // rejected (SECOND_TOKEN has HIERARCHY_INVITE/HIERARCHY_MANAGE on
      // the Group, but none at all on the Section)...
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/parent`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .send({ parentGroupId: group.id })
        .expect(404);

      // ...the pre-existing HierarchyInvitation flow is used instead: the
      // Group OWNER proposes the relationship...
      const invitation = await bodyOf<{ id: string }>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/child-invitations`)
          .set('Authorization', `Bearer ${SECOND_TOKEN}`)
          .send({ targetType: 'SECTION', targetId: section.id })
          .expect(201),
      );
      // ...and only the Section's own OWNER can accept it.
      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/hierarchy-invitations/${invitation.id}/accept`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const attached = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(attached.parentGroupId).toBe(group.id);

      // The attach never grants the new parent Group's OWNER any
      // RoleAssignment on the Section - still no access.
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${SECOND_TOKEN}`)
        .expect(404);

      // The Section's own membership/roles are exactly what they were
      // before attaching - only the original creator.
      const roleAssignments = await getSectionRoleAssignments(
        OWNER_TOKEN,
        section.id,
      );
      expect(roleAssignments).toHaveLength(2);
      for (const assignment of roleAssignments) {
        expect(assignment.user.id).toBe(localUserIdByToken.get(OWNER_TOKEN));
      }

      const members = await getSectionMembers(OWNER_TOKEN, section.id);
      expect(members).toHaveLength(1);
      expect(members[0].user.id).toBe(localUserIdByToken.get(OWNER_TOKEN));
    });
  });
});
