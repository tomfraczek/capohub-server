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
import { SectionMembershipResponseDto } from '../src/groups/dto/section-membership-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { CohortResponseDto } from '../src/groups/dto/cohort-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { Cohort } from '../src/groups/entities/cohort.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

const OWNER_TOKEN = 'valid-roleassign-owner-token';
const MEMBER_TOKEN = 'valid-roleassign-member-token';
const SECOND_TOKEN = 'valid-roleassign-second-token';

const OWNER_CLERK_ID = 'user_test_roleassign_owner';
const MEMBER_CLERK_ID = 'user_test_roleassign_member';
const SECOND_CLERK_ID = 'user_test_roleassign_second';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_roleassign_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_roleassign_owner' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_roleassign_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_roleassign_member' },
  },
  [SECOND_TOKEN]: {
    userId: SECOND_CLERK_ID,
    sessionId: 'sess_roleassign_second',
    tokenType: 'session_token',
    claims: { sub: SECOND_CLERK_ID, sid: 'sess_roleassign_second' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-owner.png',
    primaryEmailAddress: { emailAddress: 'roleassign.owner@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-member.png',
    primaryEmailAddress: { emailAddress: 'roleassign.member@example.com' },
  },
  [SECOND_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-second.png',
    primaryEmailAddress: { emailAddress: 'roleassign.second@example.com' },
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

// Membership/RoleAssignments rebuild: RoleAssignment has no `membership`
// relation at all - grants are `userId`-keyed directly (see
// role-assignment.entity.ts). Group only ever holds OWNER/ADMIN (no
// membership, no MEMBER role); Section holds the full 5-role set and
// requires an independent, active SectionMembership before any Role can be
// granted there. There is no cross-target "wrong root group" validation
// anymore (ROLE_ROOT_GROUP_MISMATCH is gone) - a grant only ever needs an
// active membership in the *exact* Section it targets.
describe('Role Assignments (e2e)', () => {
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
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: allTargetIds } },
          { section: { $in: allTargetIds } },
        ],
      });
      await cleanup.nativeDelete(Cohort, {
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
      name: 'Capoeira Role Assignments',
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
    };
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
        .send(sectionPayload(overrides))
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

  async function grantSectionRole(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<RoleAssignmentResponseDto> {
    const userId = localUserIdByToken.get(memberToken);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId, role });
    if (res.status !== 201) {
      console.error(
        'DIAG grantSectionRole failed',
        'status=',
        res.status,
        'body=',
        JSON.stringify(res.body),
        'sentUserId=',
        userId,
        'sentRole=',
        role,
        'sectionId=',
        sectionId,
      );
    }
    expect(res.status).toBe(201);
    return res.body as RoleAssignmentResponseDto;
  }

  async function createCohort(
    token: string,
    groupId: string,
    name: string,
  ): Promise<CohortResponseDto> {
    return bodyOf<CohortResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/cohorts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name, description: null })
        .expect(201),
    );
  }

  describe('granting a Role for a Section', () => {
    it('grants a Role for the Section to an already-joined member, giving direct access to it', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Grant Root' });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Grant Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

      const assignment = await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      expect(assignment.groupId).toBe(section.id);
      expect(assignment.user.id).toBe(localUserIdByToken.get(MEMBER_TOKEN));
      expect(assignment.role).toBe(GroupRole.INSTRUCTOR);

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);
    });

    it('rejects granting a Role to a user with no active membership in that exact Section - 409 ROLE_MEMBERSHIP_NOT_ACTIVE', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Never Joined Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Never Joined Section',
      });

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(MEMBER_TOKEN),
            role: GroupRole.INSTRUCTOR,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_MEMBERSHIP_NOT_ACTIVE');
    });

    it('rejects granting a Role once the membership has ended - 409 ROLE_MEMBERSHIP_NOT_ACTIVE', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Inactive Membership Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Inactive Membership Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(MEMBER_TOKEN),
            role: GroupRole.INSTRUCTOR,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_MEMBERSHIP_NOT_ACTIVE');
    });

    it('rejects granting the exact same Role twice for the same (user, Section) pair - 409 ROLE_ASSIGNMENT_ALREADY_EXISTS', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Duplicate Role Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Duplicate Role Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(MEMBER_TOKEN),
            role: GroupRole.INSTRUCTOR,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_ASSIGNMENT_ALREADY_EXISTS');
    });

    it('allows a member to hold several different Roles for the same Section at once (MEMBER + INSTRUCTOR + ADMIN)', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Multi-Role Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Multi-Role Section (Poznan)',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMember = roleAssignments
        .filter(
          (roleAssignment) =>
            roleAssignment.user.id === localUserIdByToken.get(MEMBER_TOKEN),
        )
        .map((roleAssignment) => roleAssignment.role);
      expect(rolesForMember.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.INSTRUCTOR, GroupRole.ADMIN].sort(),
      );
    });

    it('revoking one Role does not affect the others held for the same Section', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Revoke One Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Revoke One Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      const instructorAssignment = await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      await request(app.getHttpServer())
        .delete(
          `/api/v1/sections/${section.id}/role-assignments/${instructorAssignment.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMember = roleAssignments
        .filter(
          (roleAssignment) =>
            roleAssignment.user.id === localUserIdByToken.get(MEMBER_TOKEN),
        )
        .map((roleAssignment) => roleAssignment.role);
      expect(rolesForMember.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.ADMIN].sort(),
      );
      expect(rolesForMember).not.toContain(GroupRole.INSTRUCTOR);
    });
  });

  describe('exactly one OWNER per Group', () => {
    it('is enforced at the database level by a partial unique index, independent of the app-level check', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'DB Owner Uniqueness Root',
      });
      await grantGroupRole(OWNER_TOKEN, root.id, MEMBER_TOKEN, GroupRole.ADMIN);
      const em = app.get(EntityManager).fork();

      const secondOwner = new RoleAssignment();
      secondOwner.user = em.getReference(
        User,
        localUserIdByToken.get(MEMBER_TOKEN) as string,
      );
      secondOwner.group = em.getReference(Group, root.id);
      secondOwner.role = GroupRole.OWNER;
      secondOwner.grantedAt = new Date();

      const error: unknown = await em
        .persistAndFlush(secondOwner)
        .catch((caught: unknown) => caught);

      expect(error).toBeDefined();
      expect(String((error as Error).message)).toMatch(/unique/i);
    });
  });

  describe('no inheritance', () => {
    it('an ADMIN Role on the Group grants no access to a Section under it without its own Role Assignment', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Down Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'No Inherit Down Section',
      });
      await grantGroupRole(OWNER_TOKEN, root.id, MEMBER_TOKEN, GroupRole.ADMIN);

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
    });

    it('a Role granted on a Section grants no access to its parent Group at all - not even a 403, since there is zero standing there', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Up Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'No Inherit Up Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      // No Role Assignment at all on the Group itself - resolveAuthorization
      // finds nothing, so this 404s exactly like a total stranger would,
      // never a 403 (which would confirm the Group's existence to someone
      // with zero standing there).
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${root.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send(groupPayload({ name: 'Should not apply' }))
          .expect(404),
      );
      expect(response.code).toBe('GROUP_NOT_FOUND');
    });

    it('a Role granted in one Section grants no access to a sibling Section', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'No Inherit Sibling Root',
      });
      const sectionA = await createSection(OWNER_TOKEN, root.id, {
        name: 'Sibling A',
      });
      const sectionB = await createSection(OWNER_TOKEN, root.id, {
        name: 'Sibling B',
      });
      await addSectionMember(OWNER_TOKEN, sectionA.id, MEMBER_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        sectionA.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      // ADMIN in sibling A grants nothing in sibling B - never joined,
      // never granted anything there (never inherited from sibling A or
      // from the Group), so this is a 404 exactly like a non-member would
      // get - never a 403.
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/sections/${sectionB.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send(sectionPayload({ name: 'Should not apply' }))
          .expect(404),
      );
      expect(response.code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('Academy/Cohort owner-Group verification', () => {
    it('rejects PATCH /groups/:groupId/cohorts/:cohortId when the cohort belongs to a different Group - 404 COHORT_NOT_FOUND', async () => {
      const groupA = await createGroup(OWNER_TOKEN, {
        name: 'Owner Verify Group A',
      });
      const groupB = await createGroup(OWNER_TOKEN, {
        name: 'Owner Verify Group B',
      });
      const cohortInA = await createCohort(OWNER_TOKEN, groupA.id, 'Kids');

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${groupB.id}/cohorts/${cohortInA.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Hijacked', description: null })
          .expect(404),
      );
      expect(response.code).toBe('COHORT_NOT_FOUND');

      const stillIntact = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${groupA.id}/cohorts/${cohortInA.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(stillIntact.name).toBe('Kids');
    });

    it('authorizes Cohort management in a Section via a Role Assignment scoped to that Section', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Cohort Auth Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Cohort Auth Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/cohorts`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ name: 'Advanced', description: null })
        .expect(201);
    });
  });

  describe('Role Assignment inactivity after membership ends', () => {
    it('a Role Assignment grants no effective access once its Section membership is removed - the row itself is never deleted', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Inactivity Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Inactivity Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      // Every Role Assignment row still exists (soft-revoked, never
      // deleted), but grants no effective access any more - never a
      // fallback, never a stale grant.
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);

      const em = app.get(EntityManager).fork();
      const stillExists = await em.findOne(RoleAssignment, {
        user: localUserIdByToken.get(MEMBER_TOKEN),
        section: section.id,
        role: GroupRole.ADMIN,
      });
      expect(stillExists).not.toBeNull();
      expect(stillExists?.role).toBe(GroupRole.ADMIN);
      expect(stillExists?.revokedAt).not.toBeNull();
    });
  });

  describe('Role Assignment management', () => {
    it('lists and fetches Role Assignments for a Section', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'List Root' });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'List Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      const created = await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      const list = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.map((item) => item.id)).toContain(created.id);

      const fetched = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.role).toBe(GroupRole.INSTRUCTOR);
    });

    it('granting an additional Role never "changes" an existing one - both coexist, and there is no PATCH to change one directly', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Change Root' });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Change Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      const created = await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      // There is no PATCH .../role-assignments/:id - Roles are independent
      // of one another (grantRole/revokeRole only).
      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/role-assignments/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ role: GroupRole.ASSISTANT })
        .expect(404);

      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ASSISTANT,
      );

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMember = roleAssignments
        .filter(
          (roleAssignment) =>
            roleAssignment.user.id === localUserIdByToken.get(MEMBER_TOKEN),
        )
        .map((roleAssignment) => roleAssignment.role);
      // INSTRUCTOR is still there, ASSISTANT was added alongside it, and
      // MEMBER is still there too - granting ASSISTANT never replaced
      // INSTRUCTOR.
      expect(rolesForMember.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.INSTRUCTOR, GroupRole.ASSISTANT].sort(),
      );
    });

    it('revokes a non-MEMBER Role Assignment', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Revoke Root' });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Revoke Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      const created = await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/role-assignments/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const fetched = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      // The revoked row is soft-revoked, not deleted - the list only shows
      // currently-active assignments (see RoleAssignmentsService.
      // listRoleAssignments).
      expect(fetched.map((item) => item.id)).not.toContain(created.id);
    });

    it('forbids a Section MEMBER (no GROUP_EDIT there) from granting Roles in that Section', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Forbid Grant Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Forbid Grant Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await addSectionMember(OWNER_TOKEN, section.id, SECOND_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(SECOND_TOKEN),
            role: GroupRole.ADMIN,
          })
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });
  });

  describe('MEMBER is the base role of every Section, and can never be revoked directly', () => {
    it('joining a Section always grants MEMBER, and an additionally-granted Role coexists with it', async () => {
      const root = await createGroup(OWNER_TOKEN, { name: 'Base Role Root' });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Base Role Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const rolesForMember = roleAssignments
        .filter(
          (roleAssignment) =>
            roleAssignment.user.id === localUserIdByToken.get(MEMBER_TOKEN),
        )
        .map((roleAssignment) => roleAssignment.role);
      expect(rolesForMember.sort()).toEqual(
        [GroupRole.MEMBER, GroupRole.ADMIN].sort(),
      );
    });

    it('rejects revoking MEMBER directly, even when another Role is still held there - 409 CANNOT_REMOVE_MEMBER_ROLE', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Guard Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Base Role Guard Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );
      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const memberRoleAssignment = roleAssignments.find(
        (roleAssignment) =>
          roleAssignment.user.id === localUserIdByToken.get(MEMBER_TOKEN) &&
          roleAssignment.role === GroupRole.MEMBER,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/sections/${section.id}/role-assignments/${memberRoleAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_MEMBER_ROLE');
    });

    it('still rejects revoking MEMBER directly even once every other Role has been revoked - use leave/remove/ban instead', async () => {
      const root = await createGroup(OWNER_TOKEN, {
        name: 'Base Role Leave Root',
      });
      const section = await createSection(OWNER_TOKEN, root.id, {
        name: 'Base Role Leave Section',
      });
      const membership = await addSectionMember(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
      );
      const adminAssignment = await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );
      const roleAssignmentsBefore = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const memberRoleAssignment = roleAssignmentsBefore.find(
        (roleAssignment) =>
          roleAssignment.user.id === localUserIdByToken.get(MEMBER_TOKEN) &&
          roleAssignment.role === GroupRole.MEMBER,
      );

      await request(app.getHttpServer())
        .delete(
          `/api/v1/sections/${section.id}/role-assignments/${adminAssignment.id}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/sections/${section.id}/role-assignments/${memberRoleAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_MEMBER_ROLE');

      // removeMember (not revokeRole) is the actual, correct way to end
      // this - it revokes MEMBER as a side effect of ending the membership.
      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
    });
  });
});
