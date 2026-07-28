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
import { AcademyResponseDto } from '../src/groups/dto/academy-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { CohortResponseDto } from '../src/groups/dto/cohort-response.dto';
import { Academy } from '../src/groups/entities/academy.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Cohort } from '../src/groups/entities/cohort.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const OWNER_TOKEN = 'valid-hierarchy-owner-token';
const ADMIN_TOKEN = 'valid-hierarchy-admin-token';
const MEMBER_TOKEN = 'valid-hierarchy-member-token';
const OUTSIDER_TOKEN = 'valid-hierarchy-outsider-token';

const OWNER_CLERK_ID = 'user_test_hierarchy_owner';
const ADMIN_CLERK_ID = 'user_test_hierarchy_admin';
const MEMBER_CLERK_ID = 'user_test_hierarchy_member';
const OUTSIDER_CLERK_ID = 'user_test_hierarchy_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_hierarchy_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_hierarchy_owner' },
  },
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
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/hierarchy-owner.png',
    primaryEmailAddress: { emailAddress: 'hierarchy.owner@example.com' },
  },
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
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(Academy, { group: { $in: createdGroupIds } });
    await cleanup.nativeDelete(Cohort, { group: { $in: createdGroupIds } });
    await cleanup.nativeDelete(RoleAssignment, {
      group: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(GroupMembership, {
      rootGroup: { $in: createdGroupIds },
    });
    // Children must be nulled/removed before their parents to satisfy the
    // parent_group_id foreign key (no cascade - see group.entity.ts).
    await cleanup.nativeUpdate(
      Group,
      { id: { $in: createdGroupIds } },
      { parentGroup: null },
    );
    await cleanup.nativeDelete(AuditLogEntry, {
      community: { $in: createdGroupIds },
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
      // Required on Section (unlike Group, which may span multiple
      // countries) - see create-section.schema.ts.
      country: 'PL',
      city: null,
      ...overrides,
    };
  }

  // A Section can be created under a Group (`parentKind: 'groups'`) or
  // under another Section (`parentKind: 'sections'`) - the two routes are
  // dual-mounted onto the same SectionsController (see
  // sections.controller.ts). `parentId` is always the URL param, never a
  // body field.
  async function createSection(
    token: string,
    parentKind: 'groups' | 'sections',
    parentId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/${parentKind}/${parentId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload(overrides))
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
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  describe('hierarchy: create', () => {
    it('creates a Group as a root-level entity', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'World HQ' });

      // GroupResponseDto has no parent field at all any more - a Group is
      // always root-level by construction (see create-group.schema.ts).
      expect(root).not.toHaveProperty('parentGroupId');
      expect(root).not.toHaveProperty('parentId');
    });

    it('creates a Section under a Group with parentId set', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Capoeira Brasil' });

      const section = await createSection(OWNER_TOKEN, 'groups', root.id, {
        name: 'Capoeira Brasil Poland',
      });

      expect(section.parentId).toBe(root.id);
    });

    it('supports multi-level hierarchy via nested Sections and lists direct children only', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Brasil' });
      const poland = await createSection(OWNER_TOKEN, 'groups', root.id, {
        name: 'Poland',
      });
      const poznan = await createSection(OWNER_TOKEN, 'sections', poland.id, {
        name: 'Poznan',
      });

      expect(poland.parentId).toBe(root.id);
      expect(poznan.parentId).toBe(poland.id);

      const rootChildren = await bodyOf<SectionResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(rootChildren.map((section) => section.id)).toEqual([poland.id]);
      expect(rootChildren.map((section) => section.id)).not.toContain(
        poznan.id,
      );

      const polandChildren = await bodyOf<SectionResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${poland.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(polandChildren.map((section) => section.id)).toEqual([poznan.id]);
    });

    it('rejects creating a Section under a parent the caller cannot edit (non-member)', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Private Org' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send(sectionPayload({ name: 'Sneaky Section' }))
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });

    it('rejects creating a Section when the caller only has MEMBER in the parent', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Guarded Org' });
      await addMember(OWNER_TOKEN, root.id, MEMBER_TOKEN, GroupRole.MEMBER);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${root.id}/sections`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send(sectionPayload({ name: 'Blocked Section' }))
        .expect(403);

      expect((response.body as HttpErrorResponse).code).toBe(
        'INSUFFICIENT_GROUP_PERMISSIONS',
      );
    });

    it('rejects creating a Section under a non-existent parent', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/groups/00000000-0000-0000-0000-000000000000/sections')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(sectionPayload({ name: 'Orphan' }))
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('hierarchy: immutability', () => {
    it("has no move endpoint - a Section's parentId is fixed at creation", async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Immutable Root' });
      const section = await createSection(OWNER_TOKEN, 'groups', root.id, {
        name: 'Immutable Section',
      });
      const otherRoot = await createGroup(OWNER_TOKEN, {
        name: 'Immutable Other Root',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/move`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newParentGroupId: otherRoot.id })
        .expect(404);

      const fetched = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.parentId).toBe(root.id);
    });

    it('rejects an unknown field on a Group update with 400 instead of silently ignoring it', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Update Root' });
      const otherRoot = await createGroup(OWNER_TOKEN, {
        name: 'Update Other Root',
      });

      // parentGroupId is not just unrecognized - it never existed on
      // updateGroupSchema (see create-group.schema.ts) - but any unknown
      // field is rejected the same way by .strict() (update-group.schema.ts).
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/groups/${root.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
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
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.name).toBe('Update Root');
    });

    it('rejects an unknown field on a Section update with 400 instead of silently ignoring it', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Section Update Root',
      });
      const section = await createSection(OWNER_TOKEN, 'groups', root.id, {
        name: 'Section Update Child',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
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
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
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
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Kind Guard Root',
      });
      const section = await createSection(OWNER_TOKEN, 'groups', root.id, {
        name: 'Kind Guard Section',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/groups/${section.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });

    it('a Group is not reachable via GET /sections/:id (404)', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Kind Guard Root Two',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sections/${root.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
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
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Academy Owner Group',
      });

      const created = await createAcademy(OWNER_TOKEN, group.id, {
        name: 'Grunwald',
        latitude: 52.40371,
        longitude: 16.90197,
      });
      expect(created.groupId).toBe(group.id);
      expect(created.status).toBe('ACTIVE');

      const list = await bodyOf<AcademyResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/academies`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.map((academy) => academy.id)).toContain(created.id);

      const fetched = await bodyOf<AcademyResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/academies/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.name).toBe('Grunwald');

      const updated = await bodyOf<AcademyResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/academies/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
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
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(archived.status).toBe('ARCHIVED');

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/groups/${group.id}/academies/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
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
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Academy 404 Group',
      });

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/groups/${group.id}/academies/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe(
        'ACADEMY_NOT_FOUND',
      );
    });

    it('rejects a non-member from listing academies', async () => {
      const group = await createGroup(OWNER_TOKEN, {
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
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Cohort Owner Group',
      });

      const noCohorts = await bodyOf<CohortResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(noCohorts).toEqual([]);

      const kids = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Kids', description: null })
          .expect(201),
      );
      const adults = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Adults', description: null })
          .expect(201),
      );

      const list = await bodyOf<CohortResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/cohorts`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.map((cohort) => cohort.id).sort()).toEqual(
        [kids.id, adults.id].sort(),
      );

      const updated = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/cohorts/${kids.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Kids Renamed', description: 'For the little ones' })
          .expect(200),
      );
      expect(updated.name).toBe('Kids Renamed');
      expect(updated.description).toBe('For the little ones');

      const archived = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/cohorts/${kids.id}/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(archived.status).toBe('ARCHIVED');

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/cohorts/${kids.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe('COHORT_ARCHIVED');
    });

    it('returns COHORT_NOT_FOUND for an unknown cohort id', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Cohort 404 Group',
      });

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/groups/${group.id}/cohorts/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe(
        'COHORT_NOT_FOUND',
      );
    });
  });
});
