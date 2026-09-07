/**
 * Unit tests for RoleAssignmentsService - the core of the rebuilt
 * Membership/RoleAssignments/Permissions model. Covers:
 *  - resolveAuthorization(): Group branch (no membership at all, a held
 *    RoleAssignment is unconditionally authoritative) vs Section branch
 *    (requires an active SectionMembership found independently)
 *  - grantRole(): Section requires an active membership; conflict on an
 *    already-held active role
 *  - revokeRole(): OWNER and MEMBER can never be revoked directly (soft
 *    revoke otherwise - revokedAt/revokedBy set, not deleted)
 *  - transferOwnership(): Section requires the new owner to be ACTIVE
 *    (not READ_ONLY); Group requires the new owner to already be ADMIN;
 *    previous OWNER row is revoked, new one inserted, never both active
 *  - isCommunityMember(): Group vs Section branch
 */

import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupRole } from './enums/group-role.enum';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { RoleAssignmentsService } from './role-assignments.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.displayName = 'Mestre Bimba';
  return Object.assign(user, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Cordão de Ouro';
  return Object.assign(group, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Cordão de Ouro Poznan';
  return Object.assign(section, overrides);
}

function buildMembership(
  overrides: Partial<SectionMembership> = {},
): SectionMembership {
  const membership = new SectionMembership();
  membership.id = 'membership-1';
  membership.section = buildSection();
  membership.user = buildUser();
  membership.status = SectionMembershipStatus.ACTIVE;
  return Object.assign(membership, overrides);
}

function buildRoleAssignment(
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  const assignment = new RoleAssignment();
  assignment.id = 'ra-1';
  assignment.user = buildUser();
  assignment.role = GroupRole.MEMBER;
  assignment.grantedAt = new Date('2026-01-01T00:00:00.000Z');
  assignment.revokedAt = null;
  return Object.assign(assignment, overrides);
}

interface MockRouting {
  communityResult?: Group | Section | null;
  membershipResult?: SectionMembership | null;
  newOwnerMembershipResult?: SectionMembership | null;
  roleAssignmentFindResults?: RoleAssignment[];
  roleAssignmentFindOneResults?: (RoleAssignment | null)[];
  userResult?: User | null;
  suspensionResult?: null;
}

function buildMockEm(routing: MockRouting = {}) {
  const raFindOneQueue = [...(routing.roleAssignmentFindOneResults ?? [])];
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [unknown]>()
    .mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown) => {
    if (entity === SectionMembership) {
      return Promise.resolve(routing.membershipResult ?? null);
    }
    if (entity === RoleAssignment) {
      return Promise.resolve(raFindOneQueue.shift() ?? null);
    }
    if (entity === User) return Promise.resolve(routing.userResult ?? null);
    return Promise.resolve(null);
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === RoleAssignment) {
      return Promise.resolve(routing.roleAssignmentFindResults ?? []);
    }
    return Promise.resolve([]);
  });

  const raw = {
    findOne,
    find,
    persist,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: unknown) => unknown) => cb(raw)),
  };

  return { em: raw as unknown as EntityManager, findOne, find, persist, flush };
}

function buildService(
  em: EntityManager,
  routing: { communityResult?: Group | Section | null } = {},
) {
  const groupHierarchyService = {
    findCommunityById: jest
      .fn()
      .mockResolvedValue(routing.communityResult ?? null),
  } as unknown as GroupHierarchyService;

  const auditLogService = {
    record: jest.fn(),
  } as unknown as AuditLogService;

  const service = new RoleAssignmentsService(
    em,
    groupHierarchyService,
    auditLogService,
  );

  return { service, groupHierarchyService, auditLogService };
}

describe('RoleAssignmentsService', () => {
  describe('resolveAuthorization', () => {
    it('Group target: a held active RoleAssignment is unconditionally authoritative, membership is null', async () => {
      const group = buildGroup();
      const assignment = buildRoleAssignment({ role: GroupRole.OWNER, group });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [assignment],
      });
      const { service } = buildService(em, { communityResult: group });

      const result = await service.resolveAuthorization('group-1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.membership).toBeNull();
      expect(result!.roleAssignments).toEqual([assignment]);
    });

    it('Group target: returns null when the user holds no active RoleAssignment there', async () => {
      const group = buildGroup();
      const { em } = buildMockEm({ roleAssignmentFindResults: [] });
      const { service } = buildService(em, { communityResult: group });

      const result = await service.resolveAuthorization('group-1', 'user-1');

      expect(result).toBeNull();
    });

    it('Section target: requires an active SectionMembership found independently, plus an active RoleAssignment', async () => {
      const section = buildSection();
      const membership = buildMembership({ section });
      const assignment = buildRoleAssignment({
        role: GroupRole.MEMBER,
        section,
      });
      const { em } = buildMockEm({
        membershipResult: membership,
        roleAssignmentFindResults: [assignment],
      });
      const { service } = buildService(em, { communityResult: section });

      const result = await service.resolveAuthorization('section-1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.membership).toBe(membership);
      expect(result!.roleAssignments).toEqual([assignment]);
    });

    it('Section target: returns null when there is no active membership at all, even if a stale RoleAssignment exists', async () => {
      const section = buildSection();
      const { em } = buildMockEm({ membershipResult: null });
      const { service } = buildService(em, { communityResult: section });

      const result = await service.resolveAuthorization('section-1', 'user-1');

      expect(result).toBeNull();
    });

    it('returns null when the community does not exist at all', async () => {
      const { em } = buildMockEm();
      const { service } = buildService(em, { communityResult: null });

      const result = await service.resolveAuthorization('missing', 'user-1');

      expect(result).toBeNull();
    });
  });

  describe('resolvePublicView', () => {
    it('returns the Group when isPublic is true, with no RoleAssignment lookup at all', async () => {
      const group = buildGroup({ isPublic: true });
      const { em, find, findOne } = buildMockEm();
      const { service } = buildService(em, { communityResult: group });

      const result = await service.resolvePublicView('group-1');

      expect(result).toBe(group);
      expect(find).not.toHaveBeenCalled();
      expect(findOne).not.toHaveBeenCalled();
    });

    it('returns the Section when isPublic is true - no SectionMembership lookup either', async () => {
      const section = buildSection({ isPublic: true });
      const { em } = buildMockEm();
      const { service } = buildService(em, { communityResult: section });

      const result = await service.resolvePublicView('section-1');

      expect(result).toBe(section);
    });

    it('returns null when the target is Private, even though it exists', async () => {
      const group = buildGroup({ isPublic: false });
      const { em } = buildMockEm();
      const { service } = buildService(em, { communityResult: group });

      const result = await service.resolvePublicView('group-1');

      expect(result).toBeNull();
    });

    it('returns null when the target does not exist at all - the same ambiguity as resolveAuthorization', async () => {
      const { em } = buildMockEm();
      const { service } = buildService(em, { communityResult: null });

      const result = await service.resolvePublicView('missing');

      expect(result).toBeNull();
    });
  });

  describe('isCommunityMember', () => {
    it('Group: true iff an active RoleAssignment exists', async () => {
      const group = buildGroup();
      const { em } = buildMockEm({
        roleAssignmentFindOneResults: [buildRoleAssignment({ group })],
      });
      const { service } = buildService(em, { communityResult: group });

      await expect(
        service.isCommunityMember('group-1', 'user-1'),
      ).resolves.toBe(true);
    });

    it('Section: true iff an active/read-only SectionMembership exists, no role required', async () => {
      const section = buildSection();
      const { em } = buildMockEm({ membershipResult: buildMembership() });
      const { service } = buildService(em, { communityResult: section });

      await expect(
        service.isCommunityMember('section-1', 'user-1'),
      ).resolves.toBe(true);
    });
  });

  describe('grantRole', () => {
    it('Section: rejects with ROLE_MEMBERSHIP_NOT_ACTIVE when the target has no active membership', async () => {
      const section = buildSection();
      const { em } = buildMockEm({
        membershipResult: null,
        userResult: buildUser({ id: 'target-1' }),
      });
      const { service } = buildService(em, { communityResult: section });

      await expect(
        service.grantRole(
          'section-1',
          { userId: 'target-1', role: GroupRole.ADMIN },
          buildUser({ id: 'actor-1' }),
        ),
      ).rejects.toMatchObject({
        response: { code: 'ROLE_MEMBERSHIP_NOT_ACTIVE' },
      });
    });

    it('rejects with ROLE_ASSIGNMENT_ALREADY_EXISTS when the target already holds an active grant of that role', async () => {
      const group = buildGroup();
      const existing = buildRoleAssignment({ role: GroupRole.ADMIN, group });
      const { em } = buildMockEm({
        userResult: buildUser({ id: 'target-1' }),
        roleAssignmentFindOneResults: [existing],
      });
      const { service } = buildService(em, { communityResult: group });

      await expect(
        service.grantRole(
          'group-1',
          { userId: 'target-1', role: GroupRole.ADMIN },
          buildUser({ id: 'actor-1' }),
        ),
      ).rejects.toMatchObject({
        response: { code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS' },
      });
    });

    it('rejects with USER_NOT_FOUND when the target user does not exist', async () => {
      const group = buildGroup();
      const { em } = buildMockEm({ userResult: null });
      const { service } = buildService(em, { communityResult: group });

      await expect(
        service.grantRole(
          'group-1',
          { userId: 'missing', role: GroupRole.ADMIN },
          buildUser({ id: 'actor-1' }),
        ),
      ).rejects.toMatchObject({ response: { code: 'USER_NOT_FOUND' } });
    });
  });

  describe('revokeRole', () => {
    it('never revokes OWNER directly', async () => {
      const group = buildGroup();
      const ownerAssignment = buildRoleAssignment({
        role: GroupRole.OWNER,
        group,
      });
      const { em } = buildMockEm({
        roleAssignmentFindOneResults: [ownerAssignment],
      });
      const { service } = buildService(em, { communityResult: group });

      await expect(
        service.revokeRole('group-1', 'ra-1', buildUser()),
      ).rejects.toMatchObject({ response: { code: 'CANNOT_REMOVE_OWNER' } });
    });

    it('never revokes MEMBER directly - only as a side effect of ending membership', async () => {
      const section = buildSection();
      const memberAssignment = buildRoleAssignment({
        role: GroupRole.MEMBER,
        section,
      });
      const { em } = buildMockEm({
        roleAssignmentFindOneResults: [memberAssignment],
      });
      const { service } = buildService(em, { communityResult: section });

      await expect(
        service.revokeRole('section-1', 'ra-1', buildUser()),
      ).rejects.toMatchObject({
        response: { code: 'CANNOT_REMOVE_MEMBER_ROLE' },
      });
    });

    it('soft-revokes an ADMIN role - sets revokedAt/revokedBy, never deletes the row', async () => {
      const section = buildSection();
      const adminAssignment = buildRoleAssignment({
        role: GroupRole.ADMIN,
        section,
      });
      const { em } = buildMockEm({
        roleAssignmentFindOneResults: [adminAssignment],
      });
      const { service } = buildService(em, { communityResult: section });
      const actor = buildUser({ id: 'owner-1' });

      await service.revokeRole('section-1', 'ra-1', actor);

      expect(adminAssignment.revokedAt).not.toBeNull();
      expect(adminAssignment.revokedBy).toBe(actor);
    });
  });

  describe('transferOwnership', () => {
    it('rejects CANNOT_TRANSFER_TO_SELF when newOwnerUserId equals the current owner', async () => {
      const { em } = buildMockEm();
      const { service } = buildService(em);

      await expect(
        service.transferOwnership('section-1', 'user-1', 'user-1', buildUser()),
      ).rejects.toMatchObject({
        response: { code: 'CANNOT_TRANSFER_TO_SELF' },
      });
    });

    it('Section: rejects TARGET_NOT_ACTIVE_MEMBER when the new owner is READ_ONLY, not ACTIVE', async () => {
      const section = buildSection();
      const { em } = buildMockEm({
        userResult: buildUser({ id: 'user-2' }),
        membershipResult: buildMembership({
          status: SectionMembershipStatus.READ_ONLY,
        }),
      });
      const { service } = buildService(em, { communityResult: section });

      await expect(
        service.transferOwnership('section-1', 'user-1', 'user-2', buildUser()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('Group: rejects TARGET_NOT_GROUP_ADMIN when the new owner has no active ADMIN RoleAssignment there', async () => {
      const group = buildGroup();
      const { em } = buildMockEm({
        userResult: buildUser({ id: 'user-2' }),
        roleAssignmentFindOneResults: [null], // hasRole(ADMIN) check
      });
      const { service } = buildService(em, { communityResult: group });

      await expect(
        service.transferOwnership('group-1', 'user-1', 'user-2', buildUser()),
      ).rejects.toMatchObject({ response: { code: 'TARGET_NOT_GROUP_ADMIN' } });
    });

    it('Group: revokes the previous OWNER row and inserts a fresh one for the new owner when eligible', async () => {
      const group = buildGroup();
      const newOwnerUser = buildUser({ id: 'user-2' });
      const previousOwnerAssignment = buildRoleAssignment({
        id: 'ra-owner',
        role: GroupRole.OWNER,
        group,
        user: buildUser({ id: 'user-1' }),
      });
      const { em, persist } = buildMockEm({
        userResult: newOwnerUser,
        roleAssignmentFindOneResults: [
          buildRoleAssignment({
            role: GroupRole.ADMIN,
            group,
            user: newOwnerUser,
          }), // hasRole ADMIN check
          previousOwnerAssignment, // load previous OWNER row for revoke
        ],
      });
      const actor = buildUser({ id: 'actor-1' });
      const { service } = buildService(em, { communityResult: group });

      const result = await service.transferOwnership(
        'group-1',
        'user-1',
        'user-2',
        actor,
      );

      expect(previousOwnerAssignment.revokedAt).not.toBeNull();
      expect(previousOwnerAssignment.revokedBy).toBe(actor);
      expect(persist).toHaveBeenCalled();
      const insertedAssignment = persist.mock.calls.find(
        (call) => (call[0] as RoleAssignment).role === GroupRole.OWNER,
      )?.[0] as RoleAssignment;
      expect(insertedAssignment.user).toBe(newOwnerUser);
      expect(insertedAssignment.group).toBe(group);
      expect(result.previousOwner.revokedAt).not.toBeNull();
      expect(result.newOwner.revokedAt).toBeNull();
    });
  });
});
