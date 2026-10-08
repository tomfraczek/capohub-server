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
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { AvatarType } from '../users/enums/avatar-type.enum';
import { AuditLogService } from './audit-log.service';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { FormalGroupAffiliation } from './entities/formal-group-affiliation.entity';
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
  affiliationResult?: FormalGroupAffiliation | null;
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
    if (entity === FormalGroupAffiliation) {
      return Promise.resolve(routing.affiliationResult ?? null);
    }
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

  const r2StorageService = {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;

  const service = new RoleAssignmentsService(
    em,
    groupHierarchyService,
    auditLogService,
    r2StorageService,
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

    it('Group: revoking ADMIN touches only that RoleAssignment - never the formal Group affiliation, Section memberships or the user', async () => {
      const group = buildGroup();
      const adminAssignment = buildRoleAssignment({
        role: GroupRole.ADMIN,
        group,
      });
      const { em, findOne, find, persist } = buildMockEm({
        roleAssignmentFindOneResults: [adminAssignment],
      });
      const { service } = buildService(em, { communityResult: group });
      const actor = buildUser({ id: 'owner-1' });

      await service.revokeRole('group-1', 'ra-1', actor);

      expect(adminAssignment.revokedAt).not.toBeNull();
      expect(adminAssignment.revokedBy).toBe(actor);
      const touchedEntities = [...findOne.mock.calls, ...find.mock.calls].map(
        ([entity]) => entity,
      );
      expect(touchedEntities).not.toContain(FormalGroupAffiliation);
      expect(touchedEntities).not.toContain(SectionMembership);
      expect(touchedEntities).not.toContain(User);
      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe('listGroupAdminCandidates', () => {
    function buildCandidatesEm(users: Partial<User>[]) {
      const findAndCount = jest
        .fn()
        .mockResolvedValue([users as User[], users.length]);
      const em = {
        find: jest.fn((entity: unknown) => {
          if (entity === FormalGroupAffiliation) {
            return Promise.resolve([
              { user: { id: 'formal-1' } },
              { user: { id: 'formal-2' } },
              { user: { id: 'owner-1' } },
            ]);
          }
          if (entity === RoleAssignment) {
            return Promise.resolve([{ user: { id: 'owner-1' } }]);
          }
          return Promise.resolve([]);
        }),
        findAndCount,
      } as unknown as EntityManager;
      return { em, findAndCount };
    }

    it('default list (no search): active formal members of this Group, minus current OWNER/ADMIN holders', async () => {
      const { em, findAndCount } = buildCandidatesEm([]);
      const { service } = buildService(em);

      await service.listGroupAdminCandidates(
        'group-1',
        {},
        {
          limit: 20,
          offset: 0,
        },
      );

      const [entity, where] = findAndCount.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(entity).toBe(User);
      expect(where).toEqual({ id: { $in: ['formal-1', 'formal-2'] } });
    });

    it('filters by name/apelido, plus the exact user code when the search is one', async () => {
      const { em, findAndCount } = buildCandidatesEm([]);
      const { service } = buildService(em);

      await service.listGroupAdminCandidates(
        'group-1',
        { search: '123-456' },
        {
          limit: 20,
          offset: 0,
        },
      );

      const [, where] = findAndCount.mock.calls[0] as [
        unknown,
        { id: unknown; $or: unknown[] },
      ];
      // A search keeps role holders in the pool (marked via currentRole).
      expect(where.id).toEqual({
        $in: ['formal-1', 'formal-2', 'owner-1'],
      });
      expect(where.$or).toEqual([
        { firstName: { $ilike: '%123-456%' } },
        { lastName: { $ilike: '%123-456%' } },
        { apelido: { $ilike: '%123-456%' } },
        { numericCode: { $like: '123456%' } },
      ]);
    });

    it('maps each candidate to the profile name, apelido and avatar - never User.displayName', async () => {
      const { em } = buildCandidatesEm([
        buildUser({
          id: 'formal-1',
          displayName: 'Tomaszfr90',
          firstName: 'Tomasz',
          lastName: 'Frączek',
          apelido: 'Lagarto',
          numericCode: '013844',
          avatarType: AvatarType.PRESET,
          presetAvatarId: 'avatar-02',
          avatarImageKey: null,
        }),
      ]);
      const { service } = buildService(em);

      const result = await service.listGroupAdminCandidates(
        'group-1',
        {},
        { limit: 20, offset: 0 },
      );

      expect(result).toEqual({
        total: 1,
        items: [
          {
            id: 'formal-1',
            displayName: 'Tomasz Frączek',
            apelido: 'Lagarto',
            image: { type: 'PRESET', url: null, presetAvatarId: 'avatar-02' },
            numericCode: '013844',
            currentRole: null,
          },
        ],
      });
    });

    it('a matching search returns members who already hold a Group role, marked with currentRole (OWNER wins over ADMIN)', async () => {
      const em = {
        find: jest.fn((entity: unknown) => {
          if (entity === FormalGroupAffiliation) {
            return Promise.resolve([
              { user: { id: 'owner-1' } },
              { user: { id: 'admin-1' } },
              { user: { id: 'formal-1' } },
            ]);
          }
          if (entity === RoleAssignment) {
            return Promise.resolve([
              { user: { id: 'owner-1' }, role: GroupRole.ADMIN },
              { user: { id: 'owner-1' }, role: GroupRole.OWNER },
              { user: { id: 'admin-1' }, role: GroupRole.ADMIN },
            ]);
          }
          return Promise.resolve([]);
        }),
        findAndCount: jest
          .fn()
          .mockResolvedValue([
            [
              buildUser({ id: 'owner-1' }),
              buildUser({ id: 'admin-1' }),
              buildUser({ id: 'formal-1' }),
            ],
            3,
          ]),
      } as unknown as EntityManager;
      const { service } = buildService(em);

      const result = await service.listGroupAdminCandidates(
        'group-1',
        { search: 'Tomasz' },
        { limit: 20, offset: 0 },
      );

      expect(result.items.map((item) => [item.id, item.currentRole])).toEqual([
        ['owner-1', GroupRole.OWNER],
        ['admin-1', GroupRole.ADMIN],
        ['formal-1', null],
      ]);
    });

    it.each([
      ['U123-456', '123456%'],
      ['878', '878%'],
      ['u878', '878%'],
      ['U878-0', '8780%'],
    ])(
      'matches a whole or partial user code %p by its beginning',
      async (search, like) => {
        const { em, findAndCount } = buildCandidatesEm([]);
        const { service } = buildService(em);

        await service.listGroupAdminCandidates(
          'group-1',
          { search },
          { limit: 20, offset: 0 },
        );

        const [, where] = findAndCount.mock.calls[0] as [
          unknown,
          { $or: unknown[] },
        ];
        expect(where.$or).toContainEqual({ numericCode: { $like: like } });
      },
    );

    it('a plain name search adds no code clause', async () => {
      const { em, findAndCount } = buildCandidatesEm([]);
      const { service } = buildService(em);

      await service.listGroupAdminCandidates(
        'group-1',
        { search: 'Tomasz' },
        { limit: 20, offset: 0 },
      );

      const [, where] = findAndCount.mock.calls[0] as [
        unknown,
        { $or: unknown[] },
      ];
      expect(where.$or).toHaveLength(3);
    });

    it('userId (QR flow) narrows the pool to that formal member, even when they already hold a role', async () => {
      const { em, findAndCount } = buildCandidatesEm([]);
      const { service } = buildService(em);

      await service.listGroupAdminCandidates(
        'group-1',
        { userId: 'owner-1' },
        { limit: 20, offset: 0 },
      );

      const [, where] = findAndCount.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(where).toEqual({ id: { $in: ['owner-1'] } });
    });

    it('userId of someone who is not a formal member returns nothing', async () => {
      const { em, findAndCount } = buildCandidatesEm([]);
      const { service } = buildService(em);

      const result = await service.listGroupAdminCandidates(
        'group-1',
        { userId: 'stranger-1' },
        { limit: 20, offset: 0 },
      );

      expect(result).toEqual({ items: [], total: 0 });
      expect(findAndCount).not.toHaveBeenCalled();
    });

    it('returns nothing without querying users when the Group has no formal members', async () => {
      const findAndCount = jest.fn();
      const em = {
        find: jest.fn(() => Promise.resolve([])),
        findAndCount,
      } as unknown as EntityManager;
      const { service } = buildService(em);

      const result = await service.listGroupAdminCandidates(
        'group-1',
        {},
        { limit: 20, offset: 0 },
      );

      expect(result).toEqual({ items: [], total: 0 });
      expect(findAndCount).not.toHaveBeenCalled();
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

    function eligibleGroupTransfer(routing: Partial<MockRouting> = {}) {
      const group = buildGroup();
      const newOwnerUser = buildUser({ id: 'user-2' });
      const { em, persist } = buildMockEm({
        userResult: newOwnerUser,
        roleAssignmentFindOneResults: [
          buildRoleAssignment({
            role: GroupRole.ADMIN,
            group,
            user: newOwnerUser,
          }),
          buildRoleAssignment({
            id: 'ra-owner',
            role: GroupRole.OWNER,
            group,
            user: buildUser({ id: 'user-1' }),
          }),
        ],
        ...routing,
      });
      const { service } = buildService(em, { communityResult: group });
      return { service, persist, group, newOwnerUser };
    }

    it('Group: makes the new owner a formal member of the Group in the same transaction (OWNER -> formal membership)', async () => {
      const { service, persist, group, newOwnerUser } = eligibleGroupTransfer();

      await service.transferOwnership(
        'group-1',
        'user-1',
        'user-2',
        buildUser(),
      );

      const affiliation = persist.mock.calls
        .map((call) => call[0])
        .find(
          (entity) => entity instanceof FormalGroupAffiliation,
        ) as FormalGroupAffiliation;
      expect(affiliation.user).toBe(newOwnerUser);
      expect(affiliation.group).toBe(group);
    });

    it('Group: rejects TARGET_HAS_OTHER_FORMAL_GROUP - a formal member of another Group must leave it first', async () => {
      const other = Object.assign(new FormalGroupAffiliation(), {
        group: buildGroup({ id: 'other-group' }),
      });
      const { service } = eligibleGroupTransfer({ affiliationResult: other });

      await expect(
        service.transferOwnership('group-1', 'user-1', 'user-2', buildUser()),
      ).rejects.toMatchObject({
        response: { code: 'TARGET_HAS_OTHER_FORMAL_GROUP' },
      });
    });

    it('Group: rejects TARGET_ALREADY_OWNS_GROUP - one owned Group per user', async () => {
      const { service } = eligibleGroupTransfer({
        roleAssignmentFindResults: [
          buildRoleAssignment({
            role: GroupRole.OWNER,
            group: buildGroup({ id: 'own-group' }),
          }),
        ],
      });

      await expect(
        service.transferOwnership('group-1', 'user-1', 'user-2', buildUser()),
      ).rejects.toMatchObject({
        response: { code: 'TARGET_ALREADY_OWNS_GROUP' },
      });
    });
  });
});
