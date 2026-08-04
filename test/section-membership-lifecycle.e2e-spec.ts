/**
 * Targeted tests for the Membership/RoleAssignments/Permissions rebuild
 * (stage 2): OWNER lifecycle protection, revokedAt-based stint
 * disambiguation on rejoin, Section archival as a purely authorization-only
 * state, and the unified READ_ONLY permission semantics.
 *
 * Deliberately narrow, not a full re-test of every SectionMembershipsService/
 * RoleAssignmentsService method (those already have unit coverage) - this
 * file exists to prove the specific cross-cutting invariants from the
 * rebuild plan that only show up against a real database:
 *  - a Section always has exactly one active OWNER, never zero or two
 *  - a role's authority is governed by revokedAt, not by which
 *    SectionMembership stint is currently active
 *  - archiving a Section never mutates any SectionMembership/RoleAssignment
 *    row
 *  - READ_ONLY is exactly the safe-permission subset, never zero or full
 *
 * Exercises the services directly against a real database (no HTTP layer),
 * same pattern as group-hierarchy-foundation.e2e-spec.ts. Run in isolation:
 *
 *   npx jest --config test/jest-e2e.json section-membership-lifecycle
 *
 * Never part of the full `npm run test:e2e` sweep of this directory (most
 * of the other files here still reference the pre-rebuild model and do not
 * currently compile - see the rebuild's final report).
 */

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { generatePublicCode } from '../src/common/utils/public-code';
import { AppModule } from '../src/app.module';
import { closeE2eApp } from './close-e2e-app.helper';
import { User } from '../src/users/entities/user.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { MembershipSuspension } from '../src/groups/entities/membership-suspension.entity';
import { GroupStatus } from '../src/groups/enums/group-status.enum';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { SectionMembershipStatus } from '../src/groups/enums/section-membership-status.enum';
import { GroupPermission } from '../src/groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../src/groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../src/groups/role-assignments.service';
import { SectionMembershipsService } from '../src/groups/section-memberships.service';
import { assertGroupStatusAllowed } from '../src/groups/group-write-policy';

describe('Section membership/role lifecycle (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let roleAssignments: RoleAssignmentsService;
  let sectionMemberships: SectionMembershipsService;
  let groupPermissionService: GroupPermissionService;
  const createdSectionIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    em = app.get(EntityManager).fork();
    roleAssignments = app.get(RoleAssignmentsService);
    sectionMemberships = app.get(SectionMembershipsService);
    groupPermissionService = app.get(GroupPermissionService);
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(AuditLogEntry, {
        section: { $in: createdSectionIds },
      });
      await cleanup.nativeDelete(MembershipSuspension, {
        membership: { section: { $in: createdSectionIds } },
      });
      await cleanup.nativeDelete(RoleAssignment, {
        section: { $in: createdSectionIds },
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: createdSectionIds },
      });
      await cleanup.nativeDelete(Section, { id: { $in: createdSectionIds } });
      await cleanup.nativeDelete(User, { id: { $in: createdUserIds } });
    });
  });

  async function buildUser(): Promise<User> {
    const suffix = randomUUID();
    const user = new User();
    user.clerkUserId = `user_lifecycle_${suffix}`;
    user.email = `lifecycle-${suffix}@example.com`;
    user.displayName = 'Lifecycle Test User';
    user.publicCode = generatePublicCode();
    await em.persist(user).flush();
    createdUserIds.push(user.id);
    return user;
  }

  async function buildSection(): Promise<Section> {
    const section = new Section();
    section.name = `Lifecycle Section ${randomUUID().slice(0, 8)}`;
    section.publicCode = generatePublicCode();
    section.parentGroup = null;
    section.isPublic = true;
    section.isHidden = false;
    section.memberInvitesAllowed = false;
    section.status = GroupStatus.ACTIVE;
    section.timezone = 'Europe/Warsaw';
    section.currencyCode = 'PLN';
    await em.persist(section).flush();
    createdSectionIds.push(section.id);
    return section;
  }

  // Mirrors SectionsService.create's own bootstrap transaction (MEMBER +
  // OWNER granted atomically alongside a fresh SectionMembership) without
  // the parent-Group permission check that method also does - not the
  // behavior under test here.
  async function bootstrapOwner(
    section: Section,
    user: User,
  ): Promise<SectionMembership> {
    return em.transactional(async (tx) => {
      const membership = new SectionMembership();
      membership.section = section;
      membership.user = user;
      membership.joinedAt = new Date();
      tx.persist(membership);
      await roleAssignments.insertRoleAssignment(
        tx,
        user,
        section,
        GroupRole.MEMBER,
        user,
      );
      await roleAssignments.insertRoleAssignment(
        tx,
        user,
        section,
        GroupRole.OWNER,
        user,
      );
      await tx.flush();
      return membership;
    });
  }

  describe('OWNER lifecycle protection - every ending/suspending path requires transfer first', () => {
    it('blocks removeMember on the active OWNER, leaving them untouched', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      const membership = await bootstrapOwner(section, owner);

      await expect(
        sectionMemberships.removeMember(section.id, membership.id, owner),
      ).rejects.toMatchObject({ response: { code: 'CANNOT_REMOVE_OWNER' } });

      const reloaded = await em.findOneOrFail(SectionMembership, {
        id: membership.id,
      });
      expect(reloaded.status).toBe(SectionMembershipStatus.ACTIVE);
    });

    it('blocks banMember on the active OWNER, leaving them untouched', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      const membership = await bootstrapOwner(section, owner);

      await expect(
        sectionMemberships.banMember(section.id, membership.id, owner, null),
      ).rejects.toMatchObject({ response: { code: 'CANNOT_BAN_OWNER' } });

      const reloaded = await em.findOneOrFail(SectionMembership, {
        id: membership.id,
      });
      expect(reloaded.status).toBe(SectionMembershipStatus.ACTIVE);
    });

    it('blocks suspendMember on the active OWNER, leaving them untouched', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      const membership = await bootstrapOwner(section, owner);

      await expect(
        sectionMemberships.suspendMember(
          section.id,
          membership.id,
          owner,
          null,
          null,
        ),
      ).rejects.toMatchObject({ response: { code: 'CANNOT_SUSPEND_OWNER' } });

      const reloaded = await em.findOneOrFail(SectionMembership, {
        id: membership.id,
      });
      expect(reloaded.status).toBe(SectionMembershipStatus.ACTIVE);
    });

    it('blocks the active OWNER from leaving, leaving them untouched', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      const membership = await bootstrapOwner(section, owner);

      await expect(
        sectionMemberships.leave(section.id, owner),
      ).rejects.toMatchObject({
        response: { code: 'OWNER_MUST_TRANSFER_OWNERSHIP' },
      });

      const reloaded = await em.findOneOrFail(SectionMembership, {
        id: membership.id,
      });
      expect(reloaded.status).toBe(SectionMembershipStatus.ACTIVE);
    });
  });

  describe('transferOwnership', () => {
    it('moves OWNER atomically - exactly one active OWNER afterward, previous owner keeps MEMBER', async () => {
      const section = await buildSection();
      const previousOwner = await buildUser();
      await bootstrapOwner(section, previousOwner);
      const newOwner = await buildUser();
      await sectionMemberships.addMember(
        section.id,
        { userId: newOwner.id },
        previousOwner,
      );

      await roleAssignments.transferOwnership(
        section.id,
        previousOwner.id,
        newOwner.id,
        previousOwner,
      );

      const activeOwners = await em.find(RoleAssignment, {
        section: section.id,
        role: GroupRole.OWNER,
        revokedAt: null,
      });
      expect(activeOwners).toHaveLength(1);
      expect(activeOwners[0].user.id).toBe(newOwner.id);

      const previousOwnerStillMember = await roleAssignments.hasRole(
        em,
        previousOwner.id,
        section.id,
        GroupRole.MEMBER,
      );
      expect(previousOwnerStillMember).toBe(true);
    });

    it('rejects transfer to a target whose membership is READ_ONLY (suspended)', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      await bootstrapOwner(section, owner);
      const suspendedTarget = await buildUser();
      const targetMembership = await sectionMemberships.addMember(
        section.id,
        { userId: suspendedTarget.id },
        owner,
      );
      await sectionMemberships.suspendMember(
        section.id,
        targetMembership.id,
        owner,
        null,
        null,
      );

      await expect(
        roleAssignments.transferOwnership(
          section.id,
          owner.id,
          suspendedTarget.id,
          owner,
        ),
      ).rejects.toMatchObject({
        response: { code: 'TARGET_NOT_ACTIVE_MEMBER' },
      });
    });

    it('rejects transfer to a target with no active membership (already left)', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      await bootstrapOwner(section, owner);
      const formerMember = await buildUser();
      await sectionMemberships.addMember(
        section.id,
        { userId: formerMember.id },
        owner,
      );
      await sectionMemberships.leave(section.id, formerMember);

      await expect(
        roleAssignments.transferOwnership(
          section.id,
          owner.id,
          formerMember.id,
          owner,
        ),
      ).rejects.toMatchObject({
        response: { code: 'TARGET_NOT_ACTIVE_MEMBER' },
      });
    });
  });

  describe('revokedAt-based stint disambiguation', () => {
    it('ending a membership immediately revokes every held Role, including ADMIN', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      await bootstrapOwner(section, owner);
      const admin = await buildUser();
      await sectionMemberships.addMember(
        section.id,
        { userId: admin.id, role: GroupRole.ADMIN },
        owner,
      );
      expect(
        await roleAssignments.hasRole(
          em,
          admin.id,
          section.id,
          GroupRole.ADMIN,
        ),
      ).toBe(true);

      await sectionMemberships.leave(section.id, admin);

      const authorization = await roleAssignments.resolveAuthorization(
        section.id,
        admin.id,
        em,
      );
      expect(authorization).toBeNull();
      expect(
        await roleAssignments.hasRole(
          em,
          admin.id,
          section.id,
          GroupRole.ADMIN,
        ),
      ).toBe(false);
    });

    it('rejoining creates a fresh MEMBER but does not reactivate the historical ADMIN', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      await bootstrapOwner(section, owner);
      const admin = await buildUser();
      await sectionMemberships.addMember(
        section.id,
        { userId: admin.id, role: GroupRole.ADMIN },
        owner,
      );
      await sectionMemberships.leave(section.id, admin);

      // Rejoin - a brand-new SectionMembership + fresh MEMBER row.
      await sectionMemberships.addMember(
        section.id,
        { userId: admin.id },
        owner,
      );

      expect(
        await roleAssignments.hasRole(
          em,
          admin.id,
          section.id,
          GroupRole.MEMBER,
        ),
      ).toBe(true);
      expect(
        await roleAssignments.hasRole(
          em,
          admin.id,
          section.id,
          GroupRole.ADMIN,
        ),
      ).toBe(false);

      // The historical ADMIN row still exists, permanently revoked - never
      // deleted, never reactivated.
      const historicalAdmin = await em.find(RoleAssignment, {
        user: admin.id,
        section: section.id,
        role: GroupRole.ADMIN,
      });
      expect(historicalAdmin).toHaveLength(1);
      expect(historicalAdmin[0].revokedAt).not.toBeNull();
    });

    it('an explicit re-grant after rejoin creates a new active row alongside the historical one', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      await bootstrapOwner(section, owner);
      const admin = await buildUser();
      await sectionMemberships.addMember(
        section.id,
        { userId: admin.id, role: GroupRole.ADMIN },
        owner,
      );
      await sectionMemberships.leave(section.id, admin);
      await sectionMemberships.addMember(
        section.id,
        { userId: admin.id },
        owner,
      );

      await roleAssignments.grantRole(
        section.id,
        { userId: admin.id, role: GroupRole.ADMIN },
        owner,
      );

      expect(
        await roleAssignments.hasRole(
          em,
          admin.id,
          section.id,
          GroupRole.ADMIN,
        ),
      ).toBe(true);
      const allAdminRows = await em.find(RoleAssignment, {
        user: admin.id,
        section: section.id,
        role: GroupRole.ADMIN,
      });
      expect(allAdminRows).toHaveLength(2);
      expect(allAdminRows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    });
  });

  describe('Section archival is purely authorization-based', () => {
    it('archiving/unarchiving never mutates any SectionMembership or RoleAssignment row', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      await bootstrapOwner(section, owner);
      const member = await buildUser();
      await sectionMemberships.addMember(
        section.id,
        { userId: member.id },
        owner,
      );

      const beforeMemberships = await em.find(
        SectionMembership,
        { section: section.id },
        { orderBy: { id: 'asc' } },
      );
      const beforeRoles = await em.find(
        RoleAssignment,
        { section: section.id },
        { orderBy: { id: 'asc' } },
      );

      const persisted = await em.findOneOrFail(Section, { id: section.id });
      persisted.status = GroupStatus.ARCHIVED;
      await em.flush();

      // The default write-policy allow-list is ACTIVE-only - archived must
      // reject an ordinary write action for this Section.
      expect(() =>
        assertGroupStatusAllowed(persisted, [GroupStatus.ACTIVE]),
      ).toThrow();

      persisted.status = GroupStatus.ACTIVE;
      await em.flush();
      expect(() =>
        assertGroupStatusAllowed(persisted, [GroupStatus.ACTIVE]),
      ).not.toThrow();

      const afterMemberships = await em.find(
        SectionMembership,
        { section: section.id },
        { orderBy: { id: 'asc' } },
      );
      const afterRoles = await em.find(
        RoleAssignment,
        { section: section.id },
        { orderBy: { id: 'asc' } },
      );

      expect(
        afterMemberships.map((m) => [m.id, m.status, m.endReason]),
      ).toEqual(beforeMemberships.map((m) => [m.id, m.status, m.endReason]));
      expect(
        afterRoles.map((r) => [r.id, r.role, r.revokedAt?.getTime() ?? null]),
      ).toEqual(
        beforeRoles.map((r) => [r.id, r.role, r.revokedAt?.getTime() ?? null]),
      );
    });
  });

  describe('READ_ONLY permission semantics - exactly the safe subset, never zero or full', () => {
    it('a suspended MEMBER keeps GROUP_VIEW (safe) but loses GROUP_INVITE (not safe)', async () => {
      const section = await buildSection();
      const owner = await buildUser();
      await bootstrapOwner(section, owner);
      const member = await buildUser();
      const membership = await sectionMemberships.addMember(
        section.id,
        { userId: member.id },
        owner,
      );

      const activeAuthorization = await roleAssignments.resolveAuthorization(
        section.id,
        member.id,
        em,
      );
      expect(activeAuthorization).not.toBeNull();
      const activeRoles = activeAuthorization!.roleAssignments.map(
        (r) => r.role,
      );
      expect(
        groupPermissionService.hasAllPermissionsForRoles(
          'SECTION',
          activeRoles,
          [GroupPermission.GROUP_VIEW, GroupPermission.GROUP_INVITE],
          activeAuthorization!.membership!.status,
        ),
      ).toBe(true);

      await sectionMemberships.suspendMember(
        section.id,
        membership.id,
        owner,
        null,
        null,
      );

      const suspendedAuthorization = await roleAssignments.resolveAuthorization(
        section.id,
        member.id,
        em,
      );
      expect(suspendedAuthorization).not.toBeNull();
      expect(suspendedAuthorization!.membership!.status).toBe(
        SectionMembershipStatus.READ_ONLY,
      );
      const suspendedRoles = suspendedAuthorization!.roleAssignments.map(
        (r) => r.role,
      );

      expect(
        groupPermissionService.hasAllPermissionsForRoles(
          'SECTION',
          suspendedRoles,
          [GroupPermission.GROUP_VIEW],
          suspendedAuthorization!.membership!.status,
        ),
      ).toBe(true);
      expect(
        groupPermissionService.hasAllPermissionsForRoles(
          'SECTION',
          suspendedRoles,
          [GroupPermission.GROUP_INVITE],
          suspendedAuthorization!.membership!.status,
        ),
      ).toBe(false);
    });
  });
});
