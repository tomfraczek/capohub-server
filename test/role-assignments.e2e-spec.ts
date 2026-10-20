import { randomUUID } from 'node:crypto';
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
import { resolveDisplayName } from '../src/users/display-name.util';
import { User } from '../src/users/entities/user.entity';
import { SectionMembershipResponseDto } from '../src/groups/dto/section-membership-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { RoleAssignmentResponseDto } from '../src/groups/dto/role-assignment-response.dto';
import { CohortResponseDto } from '../src/groups/dto/cohort-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
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
const MEMBER_TOKEN = 'valid-roleassign-member-token';
const SECOND_TOKEN = 'valid-roleassign-second-token';

const MEMBER_CLERK_ID = 'user_test_roleassign_member';
const SECOND_CLERK_ID = 'user_test_roleassign_second';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
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
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-member.png',
    primaryEmailAddress: { emailAddress: 'roleassign.member@example.com' },
  },
  [SECOND_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/roleassign-second.png',
    primaryEmailAddress: { emailAddress: 'roleassign.second@example.com' },
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
      namePrefix: 'role-assign',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
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
      const root = await createGroup({ name: 'Grant Root' });
      const section = await createSection(root.token, root.id, {
        name: 'Grant Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);

      const assignment = await grantSectionRole(
        root.token,
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
      const root = await createGroup({
        name: 'Never Joined Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Never Joined Section',
      });

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .send({
            userId: localUserIdByToken.get(MEMBER_TOKEN),
            role: GroupRole.INSTRUCTOR,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_MEMBERSHIP_NOT_ACTIVE');
    });

    it('rejects granting a Role once the membership has ended - 409 ROLE_MEMBERSHIP_NOT_ACTIVE', async () => {
      const root = await createGroup({
        name: 'Inactive Membership Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Inactive Membership Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/leave`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .send({
            userId: localUserIdByToken.get(MEMBER_TOKEN),
            role: GroupRole.INSTRUCTOR,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_MEMBERSHIP_NOT_ACTIVE');
    });

    it('rejects granting the exact same Role twice for the same (user, Section) pair - 409 ROLE_ASSIGNMENT_ALREADY_EXISTS', async () => {
      const root = await createGroup({
        name: 'Duplicate Role Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Duplicate Role Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .send({
            userId: localUserIdByToken.get(MEMBER_TOKEN),
            role: GroupRole.INSTRUCTOR,
          })
          .expect(409),
      );
      expect(response.code).toBe('ROLE_ASSIGNMENT_ALREADY_EXISTS');
    });

    it('allows a member to hold several different Roles for the same Section at once (MEMBER + INSTRUCTOR + ADMIN)', async () => {
      const root = await createGroup({
        name: 'Multi-Role Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Multi-Role Section (Poznan)',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);

      await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );
      await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
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
      const root = await createGroup({
        name: 'Revoke One Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Revoke One Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      const instructorAssignment = await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );
      await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      await request(app.getHttpServer())
        .delete(
          `/api/v1/sections/${section.id}/role-assignments/${instructorAssignment.id}`,
        )
        .set('Authorization', `Bearer ${root.token}`)
        .expect(204);

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
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
      const root = await createGroup({
        name: 'DB Owner Uniqueness Root',
      });
      await grantGroupRole(root.token, root.id, MEMBER_TOKEN, GroupRole.ADMIN);
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
      const root = await createGroup({
        name: 'No Inherit Down Root',
      });
      // Probes /members (MEMBERSHIP_VIEW), not GET /sections/:id - a
      // Section's profile is always readable through the Public-view
      // fallback (RoleAssignmentsService.resolvePublicView), so only a
      // non-public-view route shows the ADMIN Role on the Group not
      // inheriting down.
      const section = await createSection(root.token, root.id, {
        name: 'No Inherit Down Section',
        isPublic: false,
      });
      await grantGroupRole(root.token, root.id, MEMBER_TOKEN, GroupRole.ADMIN);

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/members`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
    });

    // The Public-view fallback (RoleAssignmentsService.resolvePublicView) -
    // the mirror image of the Private case right above: a Public Section
    // is readable even by a caller with literally zero standing on it (no
    // Role Assignment, no Membership, not even one on the parent Group),
    // same as a Public Group (see groups.e2e-spec.ts's own "on a Public
    // Group" test).
    it('a Public Section is readable by a caller with zero Role Assignment/Membership at all', async () => {
      const root = await createGroup({
        name: 'Public Section View Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Public Section View Section',
        isPublic: true,
      });

      const details = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(details.id).toBe(section.id);
    });

    // Regression: a Section's isPublic is "Dołączanie publiczne" (join
    // without approval), not visibility - an approval-only Section found
    // via Discover must still open, or there is no screen to send the
    // join request from.
    it('an approval-only (isPublic: false) Section is still readable by a caller with zero Role Assignment/Membership', async () => {
      const root = await createGroup({
        name: 'Approval Section View Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Approval Section View Section',
        isPublic: false,
      });

      const details = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(details.id).toBe(section.id);
    });

    it('a Role granted on a Section grants no access to its parent Group at all - not even a 403, since there is zero standing there', async () => {
      const root = await createGroup({
        name: 'No Inherit Up Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'No Inherit Up Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        root.token,
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
      const root = await createGroup({
        name: 'No Inherit Sibling Root',
      });
      const sectionA = await createSection(root.token, root.id, {
        name: 'Sibling A',
      });
      const sectionB = await createSection(root.token, root.id, {
        name: 'Sibling B',
      });
      await addSectionMember(root.token, sectionA.id, MEMBER_TOKEN);
      await grantSectionRole(
        root.token,
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
      const groupA = await createGroup({
        name: 'Owner Verify Group A',
      });
      const groupB = await createGroup({
        name: 'Owner Verify Group B',
      });
      const cohortInA = await createCohort(groupA.token, groupA.id, 'Kids');

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${groupB.id}/cohorts/${cohortInA.id}`)
          .set('Authorization', `Bearer ${groupA.token}`)
          .send({ name: 'Hijacked', description: null })
          .expect(404),
      );
      expect(response.code).toBe('COHORT_NOT_FOUND');

      const stillIntact = await bodyOf<CohortResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${groupA.id}/cohorts/${cohortInA.id}`)
          .set('Authorization', `Bearer ${groupA.token}`)
          .expect(200),
      );
      expect(stillIntact.name).toBe('Kids');
    });

    it('authorizes Cohort management in a Section via a Role Assignment scoped to that Section', async () => {
      const root = await createGroup({
        name: 'Cohort Auth Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Cohort Auth Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        root.token,
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
      const root = await createGroup({
        name: 'Inactivity Root',
      });
      // The final 404 probes /members (MEMBERSHIP_VIEW), not GET
      // /sections/:id - a Section's profile stays readable to anyone via
      // the Public-view fallback (RoleAssignmentsService.resolvePublicView),
      // so only a non-public-view route shows the removed membership
      // granting no effective access.
      const section = await createSection(root.token, root.id, {
        name: 'Inactivity Section',
        isPublic: false,
      });
      const membership = await addSectionMember(
        root.token,
        section.id,
        MEMBER_TOKEN,
      );
      await grantSectionRole(
        root.token,
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
        .set('Authorization', `Bearer ${root.token}`)
        .expect(204);

      // Every Role Assignment row still exists (soft-revoked, never
      // deleted), but grants no effective access any more - never a
      // fallback, never a stale grant.
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/members`)
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
      const root = await createGroup({ name: 'List Root' });
      const section = await createSection(root.token, root.id, {
        name: 'List Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      const created = await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      const list = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(list.map((item) => item.id)).toContain(created.id);

      const fetched = await bodyOf<RoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments/${created.id}`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      expect(fetched.role).toBe(GroupRole.INSTRUCTOR);
    });

    it('granting an additional Role never "changes" an existing one - both coexist, and there is no PATCH to change one directly', async () => {
      const root = await createGroup({ name: 'Change Root' });
      const section = await createSection(root.token, root.id, {
        name: 'Change Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      const created = await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      // There is no PATCH .../role-assignments/:id - Roles are independent
      // of one another (grantRole/revokeRole only).
      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/role-assignments/${created.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .send({ role: GroupRole.ASSISTANT })
        .expect(404);

      await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ASSISTANT,
      );

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
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
      const root = await createGroup({ name: 'Revoke Root' });
      const section = await createSection(root.token, root.id, {
        name: 'Revoke Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      const created = await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/role-assignments/${created.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .expect(204);

      const fetched = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
          .expect(200),
      );
      // The revoked row is soft-revoked, not deleted - the list only shows
      // currently-active assignments (see RoleAssignmentsService.
      // listRoleAssignments).
      expect(fetched.map((item) => item.id)).not.toContain(created.id);
    });

    it('forbids a Section MEMBER (no GROUP_EDIT there) from granting Roles in that Section', async () => {
      const root = await createGroup({
        name: 'Forbid Grant Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Forbid Grant Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      await addSectionMember(root.token, section.id, SECOND_TOKEN);

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
      const root = await createGroup({ name: 'Base Role Root' });
      const section = await createSection(root.token, root.id, {
        name: 'Base Role Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );

      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
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
      const root = await createGroup({
        name: 'Base Role Guard Root',
      });
      const section = await createSection(root.token, root.id, {
        name: 'Base Role Guard Section',
      });
      await addSectionMember(root.token, section.id, MEMBER_TOKEN);
      await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );
      const roleAssignments = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
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
          .set('Authorization', `Bearer ${root.token}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_MEMBER_ROLE');
    });

    it('still rejects revoking MEMBER directly even once every other Role has been revoked - use leave/remove/ban instead', async () => {
      const root = await createGroup({
        name: 'Base Role Leave Root',
      });
      // The final 404 probes /members (MEMBERSHIP_VIEW) - a Section's
      // profile stays readable to anyone via the Public-view fallback
      // (RoleAssignmentsService.resolvePublicView).
      const section = await createSection(root.token, root.id, {
        name: 'Base Role Leave Section',
        isPublic: false,
      });
      const membership = await addSectionMember(
        root.token,
        section.id,
        MEMBER_TOKEN,
      );
      const adminAssignment = await grantSectionRole(
        root.token,
        section.id,
        MEMBER_TOKEN,
        GroupRole.ADMIN,
      );
      const roleAssignmentsBefore = await bodyOf<RoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/role-assignments`)
          .set('Authorization', `Bearer ${root.token}`)
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
        .set('Authorization', `Bearer ${root.token}`)
        .expect(204);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(
            `/api/v1/sections/${section.id}/role-assignments/${memberRoleAssignment?.id}`,
          )
          .set('Authorization', `Bearer ${root.token}`)
          .expect(409),
      );
      expect(response.code).toBe('CANNOT_REMOVE_MEMBER_ROLE');

      // removeMember (not revokeRole) is the actual, correct way to end
      // this - it revokes MEMBER as a side effect of ending the membership.
      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/members`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
    });
  });

  // SectionResponseDto.instructors ("Prowadzący" on the Section profile) -
  // exercised end-to-end through GET /sections/:id: DB -> SectionsService
  // -> section.mapper -> controller.
  describe('GET /sections/:id instructors', () => {
    // Same per-call fixture-user bootstrap as createFreshGroupOwner, minus
    // the Group - these users only ever join Sections. Registered into
    // TOKEN_TO_AUTH/FIXTURE_CLERK_PROFILES in place, so afterAll's
    // `Object.keys(FIXTURE_CLERK_PROFILES)` cleanup already covers them.
    async function registerFixtureUser(
      label: string,
    ): Promise<{ token: string; userId: string; displayName: string }> {
      const suffix = `instructors-${label}-${randomUUID().slice(0, 8)}`;
      const clerkUserId = `user_test_${suffix}`;
      const token = `valid-${suffix}-token`;
      TOKEN_TO_AUTH[token] = {
        userId: clerkUserId,
        sessionId: `sess_${suffix}`,
        tokenType: 'session_token',
        claims: { sub: clerkUserId, sid: `sess_${suffix}` },
      };
      FIXTURE_CLERK_PROFILES[clerkUserId] = {
        imageUrl: `https://img.clerk.com/${suffix}.png`,
        primaryEmailAddress: { emailAddress: `${suffix}@example.com` },
      };
      await request(app.getHttpServer())
        .get('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, { clerkUserId });
      localUserIdByToken.set(token, user.id);
      return {
        token,
        userId: user.id,
        displayName: resolveDisplayName(user),
      };
    }

    async function getSection(
      token: string,
      sectionId: string,
    ): Promise<SectionResponseDto> {
      return bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${sectionId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      );
    }

    it('lists only active INSTRUCTOR holders of this exact Section, earliest-granted first, regardless of membersVisibility', async () => {
      const root = await createGroup({ name: 'Instructors Root' });
      localUserIdByToken.set(root.token, root.userId);
      // PRIVATE members list + public Section: a stranger may open the
      // profile but not the member list - instructors must still be there.
      const section = await createSection(root.token, root.id, {
        name: 'Instructors Section',
        membersVisibility: 'PRIVATE',
      });
      const otherSection = await createSection(root.token, root.id, {
        name: 'Instructors Other Section',
      });

      const admin = await registerFixtureUser('admin');
      const assistant = await registerFixtureUser('assistant');
      const plainMember = await registerFixtureUser('member');
      const firstInstructor = await registerFixtureUser('first');
      const secondInstructor = await registerFixtureUser('second');
      const revokedInstructor = await registerFixtureUser('revoked');
      const otherSectionInstructor = await registerFixtureUser('other');
      const stranger = await registerFixtureUser('stranger');

      for (const user of [
        admin,
        assistant,
        plainMember,
        firstInstructor,
        secondInstructor,
        revokedInstructor,
      ]) {
        await addSectionMember(root.token, section.id, user.token);
      }
      await addSectionMember(
        root.token,
        otherSection.id,
        otherSectionInstructor.token,
      );

      await grantSectionRole(
        root.token,
        section.id,
        admin.token,
        GroupRole.ADMIN,
      );
      await grantSectionRole(
        root.token,
        section.id,
        assistant.token,
        GroupRole.ASSISTANT,
      );
      await grantSectionRole(
        root.token,
        section.id,
        firstInstructor.token,
        GroupRole.INSTRUCTOR,
      );
      const revoked = await grantSectionRole(
        root.token,
        section.id,
        revokedInstructor.token,
        GroupRole.INSTRUCTOR,
      );
      await grantSectionRole(
        root.token,
        section.id,
        secondInstructor.token,
        GroupRole.INSTRUCTOR,
      );
      await grantSectionRole(
        root.token,
        otherSection.id,
        otherSectionInstructor.token,
        GroupRole.INSTRUCTOR,
      );
      await request(app.getHttpServer())
        .delete(`/api/v1/sections/${section.id}/role-assignments/${revoked.id}`)
        .set('Authorization', `Bearer ${root.token}`)
        .expect(204);

      const expected = [
        {
          id: firstInstructor.userId,
          displayName: firstInstructor.displayName,
        },
        {
          id: secondInstructor.userId,
          displayName: secondInstructor.displayName,
        },
      ];

      // Owner's view and a stranger's view (PRIVATE members list) agree.
      for (const viewerToken of [root.token, stranger.token]) {
        const body = await getSection(viewerToken, section.id);
        expect(body.membersVisibility).toBe('PRIVATE');
        // Exact list = the INSTRUCTORs present, in grant order, and nobody
        // else: not the OWNER (who holds no INSTRUCTOR role here), ADMIN,
        // ASSISTANT, a plain MEMBER, the revoked INSTRUCTOR or the other
        // Section's INSTRUCTOR.
        expect(body.instructors).toEqual(expected);
        const ids = body.instructors.map((instructor) => instructor.id);
        for (const excluded of [
          root.userId,
          admin.userId,
          assistant.userId,
          plainMember.userId,
          revokedInstructor.userId,
          otherSectionInstructor.userId,
        ]) {
          expect(ids).not.toContain(excluded);
        }
      }

      // ...and the other Section lists only its own INSTRUCTOR.
      const other = await getSection(root.token, otherSection.id);
      expect(other.instructors).toEqual([
        {
          id: otherSectionInstructor.userId,
          displayName: otherSectionInstructor.displayName,
        },
      ]);
    });

    it('lists the OWNER once they also hold INSTRUCTOR', async () => {
      const root = await createGroup({ name: 'Owner Instructor Root' });
      localUserIdByToken.set(root.token, root.userId);
      const section = await createSection(root.token, root.id, {
        name: 'Owner Instructor Section',
      });

      expect((await getSection(root.token, section.id)).instructors).toEqual(
        [],
      );

      await grantSectionRole(
        root.token,
        section.id,
        root.token,
        GroupRole.INSTRUCTOR,
      );

      const body = await getSection(root.token, section.id);
      expect(body.instructors).toHaveLength(1);
      expect(body.instructors[0].id).toBe(root.userId);
      expect(typeof body.instructors[0].displayName).toBe('string');
      expect(body.instructors[0].displayName.length).toBeGreaterThan(0);
    });
  });
});
