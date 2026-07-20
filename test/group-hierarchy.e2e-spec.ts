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
import { Academy } from '../src/groups/entities/academy.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
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

describe('Group Hierarchy / Academies / Sections (e2e)', () => {
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
    await cleanup.nativeDelete(Section, { group: { $in: createdGroupIds } });
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
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  describe('hierarchy: create', () => {
    it('creates a Root Group with parentGroupId null', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'World HQ' });

      expect(root.parentGroupId).toBeNull();
    });

    it('creates a Child Group under a Root Group when the caller can edit the parent', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Capoeira Brasil' });

      const child = await createGroup(OWNER_TOKEN, {
        name: 'Capoeira Brasil Poland',
        parentGroupId: root.id,
      });

      expect(child.parentGroupId).toBe(root.id);
    });

    it('supports multi-level hierarchy and lists direct children only', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Brasil' });
      const poland = await createGroup(OWNER_TOKEN, {
        name: 'Poland',
        parentGroupId: root.id,
      });
      const poznan = await createGroup(OWNER_TOKEN, {
        name: 'Poznan',
        parentGroupId: poland.id,
      });

      const rootChildren = await bodyOf<GroupResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${root.id}/children`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(rootChildren.map((group) => group.id)).toEqual([poland.id]);
      expect(rootChildren.map((group) => group.id)).not.toContain(poznan.id);

      const polandChildren = await bodyOf<GroupResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${poland.id}/children`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(polandChildren.map((group) => group.id)).toEqual([poznan.id]);
    });

    it('rejects creating a child under a parent the caller cannot edit (non-member)', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Private Org' });

      const response = await request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send(groupPayload({ name: 'Sneaky Child', parentGroupId: root.id }))
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_PARENT_NOT_FOUND',
      );
    });

    it('rejects creating a child when the caller only has MEMBER in the parent', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Guarded Org' });
      await addMember(OWNER_TOKEN, root.id, MEMBER_TOKEN, GroupRole.MEMBER);

      const response = await request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send(groupPayload({ name: 'Blocked Child', parentGroupId: root.id }))
        .expect(403);

      expect((response.body as HttpErrorResponse).code).toBe(
        'INSUFFICIENT_GROUP_PERMISSIONS',
      );
    });

    it('rejects creating a child under a non-existent parent', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(
          groupPayload({
            name: 'Orphan',
            parentGroupId: '00000000-0000-0000-0000-000000000000',
          }),
        )
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe(
        'GROUP_PARENT_NOT_FOUND',
      );
    });
  });

  describe('hierarchy: immutability', () => {
    it('has no move endpoint - parentGroupId is fixed at creation', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Immutable Root' });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Immutable Child',
        parentGroupId: root.id,
      });
      const otherRoot = await createGroup(OWNER_TOKEN, {
        name: 'Immutable Other Root',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/move`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newParentGroupId: otherRoot.id })
        .expect(404);

      const fetched = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.parentGroupId).toBe(root.id);
    });

    it('rejects parentGroupId on update with 400 instead of silently ignoring it', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Update Root' });
      const otherRoot = await createGroup(OWNER_TOKEN, {
        name: 'Update Other Root',
      });
      const child = await createGroup(OWNER_TOKEN, {
        name: 'Update Child',
        parentGroupId: root.id,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/groups/${child.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(
          groupPayload({
            name: 'Update Child Renamed',
            parentGroupId: otherRoot.id,
          }),
        )
        .expect(400);

      expect((response.body as HttpErrorResponse).code).toBe(
        'VALIDATION_ERROR',
      );

      const fetched = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${child.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.name).toBe('Update Child');
      expect(fetched.parentGroupId).toBe(root.id);
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

  describe('sections', () => {
    it('creates, lists, gets, updates and archives a section, and a group works with zero sections', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Section Owner Group',
      });

      const noSections = await bodyOf<SectionResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(noSections).toEqual([]);

      const kids = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Kids', description: null })
          .expect(201),
      );
      const adults = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Adults', description: null })
          .expect(201),
      );

      const list = await bodyOf<SectionResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.map((section) => section.id).sort()).toEqual(
        [kids.id, adults.id].sort(),
      );

      const updated = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/sections/${kids.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Kids Renamed', description: 'For the little ones' })
          .expect(200),
      );
      expect(updated.name).toBe('Kids Renamed');
      expect(updated.description).toBe('For the little ones');

      const archived = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/sections/${kids.id}/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201),
      );
      expect(archived.status).toBe('ARCHIVED');

      const response = await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/sections/${kids.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);
      expect((response.body as HttpErrorResponse).code).toBe(
        'SECTION_ARCHIVED',
      );
    });

    it('returns SECTION_NOT_FOUND for an unknown section id', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Section 404 Group',
      });

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/groups/${group.id}/sections/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);

      expect((response.body as HttpErrorResponse).code).toBe(
        'SECTION_NOT_FOUND',
      );
    });
  });
});
