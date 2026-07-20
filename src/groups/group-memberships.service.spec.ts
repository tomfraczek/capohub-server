import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
  GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  GroupMembership,
} from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { MembershipSection } from './entities/membership-section.entity';
import { Section } from './entities/section.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipEndReason } from './enums/membership-end-reason.enum';
import { SectionStatus } from './enums/section-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupMembershipsService } from './group-memberships.service';

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'root-1';
  group.name = 'Capoeira Angola SP';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  return Object.assign(group, overrides);
}

function buildMembership(
  overrides: Partial<GroupMembership> = {},
): GroupMembership {
  const membership = new GroupMembership();
  membership.id = 'membership-1';
  membership.role = GroupRole.MEMBER;
  membership.status = GroupMembershipStatus.ACTIVE;
  membership.rootGroup = buildGroup();
  membership.user = { id: 'user-1', displayName: 'Member' } as never;
  return Object.assign(membership, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Kids';
  section.status = SectionStatus.ACTIVE;
  section.group = buildGroup();
  return Object.assign(section, overrides);
}

interface FindOneCall {
  entity: unknown;
  where: Record<string, unknown>;
}

interface MockRouting {
  // findOne results, keyed by entity constructor - each is consumed as a
  // FIFO queue so a test can express "first call returns X, second
  // returns Y" for repeated lookups of the same entity type (e.g.
  // transferOwnership loading two different memberships).
  groupResults?: (Group | null)[];
  userResults?: (User | null)[];
  membershipResults?: (GroupMembership | null)[];
  sectionResults?: (Section | null)[];
  membershipSectionResults?: (MembershipSection | null)[];
  sectionRefs?: { id: string; name: string }[];
  flushError?: Error;
}

function buildMockEm(routing: MockRouting = {}) {
  const groupQueue = [...(routing.groupResults ?? [])];
  const userQueue = [...(routing.userResults ?? [])];
  const membershipQueue = [...(routing.membershipResults ?? [])];
  const sectionQueue = [...(routing.sectionResults ?? [])];
  const membershipSectionQueue = [...(routing.membershipSectionResults ?? [])];

  const findOneCalls: FindOneCall[] = [];

  const flush = routing.flushError
    ? jest.fn().mockRejectedValue(routing.flushError)
    : jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object]>()
    .mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    findOneCalls.push({ entity, where });
    if (entity === Group) {
      return Promise.resolve(groupQueue.shift() ?? null);
    }
    if (entity === User) {
      return Promise.resolve(userQueue.shift() ?? null);
    }
    if (entity === GroupMembership) {
      return Promise.resolve(membershipQueue.shift() ?? null);
    }
    if (entity === Section) {
      return Promise.resolve(sectionQueue.shift() ?? null);
    }
    if (entity === MembershipSection) {
      return Promise.resolve(membershipSectionQueue.shift() ?? null);
    }
    throw new Error(
      `Unexpected findOne entity in test mock: ${String(entity)}`,
    );
  });

  const find = jest.fn(() => Promise.resolve(routing.sectionRefs ?? []));

  const getReference = jest
    .fn()
    .mockImplementation((_entity: unknown, id: string) => ({ id }));

  const raw = {
    findOne,
    find,
    persist,
    remove,
    getReference,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return {
    em: raw as unknown as EntityManager,
    persist,
    remove,
    findOne,
    find,
    findOneCalls,
  };
}

function buildService(
  em: EntityManager,
  getRootGroupImpl?: (groupId: string) => Promise<Group>,
) {
  const groupHierarchyService = {
    getRootGroup: getRootGroupImpl ?? (() => Promise.resolve(buildGroup())),
  } as unknown as GroupHierarchyService;

  return new GroupMembershipsService(em, groupHierarchyService);
}

describe('GroupMembershipsService', () => {
  describe('addMember', () => {
    it('creates a new active membership for an existing user in a Root Group', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em, persist } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [null],
      });
      const service = buildService(em);

      await service.addMember('root-1', {
        userId: 'user-2',
        role: GroupRole.MEMBER,
      });

      const persisted = persist.mock.calls[0][0] as GroupMembership;
      expect(persisted.role).toBe(GroupRole.MEMBER);
      expect(persisted.user).toBe(user);
      expect(persisted.rootGroup.id).toBe('root-1');
    });

    it('rejects with MEMBERSHIP_ROOT_GROUP_MISMATCH when the target group is a Child Group', async () => {
      const childGroup = buildGroup({ id: 'child-1' });
      childGroup.parentGroup = buildGroup({ id: 'root-1' });
      const { em } = buildMockEm({ groupResults: [childGroup] });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('child-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_ROOT_GROUP_MISMATCH',
      });
    });

    it('rejects with GROUP_NOT_FOUND when the root group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      await expect(
        service.addMember('missing', {
          userId: 'user-2',
          role: GroupRole.MEMBER,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with USER_NOT_FOUND when the target user does not exist', async () => {
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('root-1', { userId: 'missing', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('rejects with ALREADY_A_MEMBER when the user already has an active membership in this Root Group', async () => {
      const user = new User();
      user.id = 'user-2';
      const existingMembership = buildMembership();
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [existingMembership],
      });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('root-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_A_MEMBER',
      });
    });

    it('allows the same user to have active memberships in two different Root Groups', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em, persist } = buildMockEm({
        groupResults: [buildGroup({ id: 'root-2' })],
        userResults: [user],
        // No existing membership found *for root-2* - a membership the
        // user holds elsewhere (root-1) is a different Root Group and is
        // simply never looked up here (loadActiveMembership is always
        // scoped to the target rootGroupId).
        membershipResults: [null],
      });
      const service = buildService(em);

      await service.addMember('root-2', {
        userId: 'user-2',
        role: GroupRole.MEMBER,
      });

      const persisted = persist.mock.calls[0][0] as GroupMembership;
      expect(persisted.rootGroup.id).toBe('root-2');
    });

    it('maps a database-level unique-violation race to ALREADY_A_MEMBER instead of a raw DB error', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [null],
        flushError: new UniqueConstraintViolationException(
          new Error(
            `duplicate key value violates unique constraint "${GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX}"`,
          ),
        ),
      });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('root-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_A_MEMBER',
      });
    });
  });

  describe('getMembership', () => {
    it('returns a membership regardless of status - history remains readable', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.ARCHIVED,
        endReason: MembershipEndReason.LEFT,
        leftAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      const result = await service.getMembership('root-1', 'membership-1');

      expect(result.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(result.endReason).toBe(MembershipEndReason.LEFT);
    });

    it('throws MEMBERSHIP_NOT_FOUND when the membership does not exist', async () => {
      const { em } = buildMockEm({ membershipResults: [null] });
      const service = buildService(em);

      const error: unknown = await service
        .getMembership('root-1', 'missing')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_FOUND',
      });
    });
  });

  describe('changeRole', () => {
    it('updates the role of a non-owner membership', async () => {
      const membership = buildMembership({ role: GroupRole.MEMBER });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      await service.changeRole('root-1', 'membership-1', {
        role: GroupRole.ADMIN,
      });

      expect(membership.role).toBe(GroupRole.ADMIN);
    });

    it('rejects with CANNOT_CHANGE_OWNER_ROLE when the target is the owner', async () => {
      const membership = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      const error: unknown = await service
        .changeRole('root-1', 'membership-1', { role: GroupRole.ADMIN })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_CHANGE_OWNER_ROLE',
      });
    });

    it('throws NotFoundException when the membership does not exist', async () => {
      const { em } = buildMockEm({ membershipResults: [null] });
      const service = buildService(em);

      await expect(
        service.changeRole('root-1', 'missing', { role: GroupRole.ADMIN }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('archives the membership with endReason REMOVED, preserving history', async () => {
      const membership = buildMembership({ role: GroupRole.ADMIN });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      await service.removeMember('root-1', 'membership-1');

      expect(membership.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(membership.endReason).toBe(MembershipEndReason.REMOVED);
      expect(membership.leftAt).not.toBeNull();
      expect(membership.role).toBe(GroupRole.ADMIN);
    });

    it('rejects with CANNOT_REMOVE_OWNER when the target is the owner', async () => {
      const membership = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      const error: unknown = await service
        .removeMember('root-1', 'membership-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_OWNER',
      });
    });
  });

  describe('leave', () => {
    it('archives the membership with endReason LEFT for a non-owner', async () => {
      const membership = buildMembership({ role: GroupRole.MEMBER });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      await service.leave('root-1', 'user-1');

      expect(membership.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(membership.endReason).toBe(MembershipEndReason.LEFT);
      expect(membership.leftAt).not.toBeNull();
    });

    it('rejects with OWNER_MUST_TRANSFER_OWNERSHIP when the caller is the owner', async () => {
      const membership = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      const error: unknown = await service
        .leave('root-1', 'user-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
      });
    });
  });

  describe('transferOwnership', () => {
    it('rejects transferring to self', async () => {
      const { em } = buildMockEm();
      const service = buildService(em);

      const error: unknown = await service
        .transferOwnership('root-1', 'user-1', {
          newOwnerUserId: 'user-1',
          previousOwnerRole: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'CANNOT_TRANSFER_TO_SELF',
      });
    });

    it('rejects with TARGET_NOT_A_MEMBER when the new owner has no active membership', async () => {
      const previousOwner = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({
        membershipResults: [previousOwner, null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .transferOwnership('root-1', 'user-1', {
          newOwnerUserId: 'user-2',
          previousOwnerRole: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'TARGET_NOT_A_MEMBER',
      });
    });

    it('sets the previous owner to previousOwnerRole and the target to OWNER', async () => {
      const previousOwner = buildMembership({
        id: 'membership-owner',
        role: GroupRole.OWNER,
      });
      const newOwner = buildMembership({
        id: 'membership-target',
        role: GroupRole.MEMBER,
      });
      const { em } = buildMockEm({
        membershipResults: [previousOwner, newOwner],
      });
      const service = buildService(em);

      await service.transferOwnership('root-1', 'user-1', {
        newOwnerUserId: 'user-2',
        previousOwnerRole: GroupRole.ADMIN,
      });

      expect(previousOwner.role).toBe(GroupRole.ADMIN);
      expect(newOwner.role).toBe(GroupRole.OWNER);
    });
  });

  describe('assignSection', () => {
    it('assigns an active membership to a section in the same Root Group', async () => {
      const membership = buildMembership();
      const section = buildSection();
      const { em, persist } = buildMockEm({
        membershipResults: [membership],
        sectionResults: [section],
        membershipSectionResults: [null],
      });
      const service = buildService(em, () => Promise.resolve(buildGroup()));

      await service.assignSection('root-1', 'membership-1', 'section-1');

      const persisted = persist.mock.calls[0][0] as MembershipSection;
      expect(persisted.membership).toEqual({ id: 'membership-1' });
      expect(persisted.section).toEqual({ id: 'section-1' });
    });

    it('rejects assigning a section to an inactive membership', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.ARCHIVED,
      });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      const error: unknown = await service
        .assignSection('root-1', 'membership-1', 'section-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_ACTIVE',
      });
    });

    it('rejects with SECTION_NOT_FOUND when the section does not exist', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        sectionResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignSection('root-1', 'membership-1', 'missing')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'SECTION_NOT_FOUND',
      });
    });

    it('rejects assigning an archived section', async () => {
      const membership = buildMembership();
      const section = buildSection({ status: SectionStatus.ARCHIVED });
      const { em } = buildMockEm({
        membershipResults: [membership],
        sectionResults: [section],
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignSection('root-1', 'membership-1', 'section-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_SECTION_ARCHIVED',
      });
    });

    it('rejects a section belonging to a different Root Group', async () => {
      const membership = buildMembership();
      const section = buildSection({
        group: buildGroup({ id: 'child-of-other-root' }),
      });
      const { em } = buildMockEm({
        membershipResults: [membership],
        sectionResults: [section],
      });
      const service = buildService(em, () =>
        Promise.resolve(buildGroup({ id: 'other-root' })),
      );

      const error: unknown = await service
        .assignSection('root-1', 'membership-1', 'section-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_SECTION_MISMATCH',
      });
    });

    it('rejects a duplicate assignment', async () => {
      const membership = buildMembership();
      const section = buildSection();
      const existingAssignment = new MembershipSection();
      const { em } = buildMockEm({
        membershipResults: [membership],
        sectionResults: [section],
        membershipSectionResults: [existingAssignment],
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignSection('root-1', 'membership-1', 'section-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_SECTION_ALREADY_ASSIGNED',
      });
    });

    it('maps a database-level unique-violation race to MEMBERSHIP_SECTION_ALREADY_ASSIGNED', async () => {
      const membership = buildMembership();
      const section = buildSection();
      const { em } = buildMockEm({
        membershipResults: [membership],
        sectionResults: [section],
        membershipSectionResults: [null],
        flushError: new UniqueConstraintViolationException(
          new Error(
            'duplicate key value violates unique constraint "membership_sections_membership_id_section_id_unique"',
          ),
        ),
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignSection('root-1', 'membership-1', 'section-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_SECTION_ALREADY_ASSIGNED',
      });
    });
  });

  describe('unassignSection', () => {
    it('removes an existing assignment', async () => {
      const membership = buildMembership();
      const assignment = new MembershipSection();
      const { em, remove } = buildMockEm({
        membershipResults: [membership],
        membershipSectionResults: [assignment],
      });
      const service = buildService(em);

      await service.unassignSection('root-1', 'membership-1', 'section-1');

      expect(remove).toHaveBeenCalledWith(assignment);
    });

    it('throws MEMBERSHIP_SECTION_ASSIGNMENT_NOT_FOUND when no assignment exists', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        membershipSectionResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .unassignSection('root-1', 'membership-1', 'section-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_SECTION_ASSIGNMENT_NOT_FOUND',
      });
    });
  });
});
