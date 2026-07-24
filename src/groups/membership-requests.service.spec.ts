/**
 * Unit tests for MembershipRequestsService.
 *
 * Covers:
 *  - join(): public group → auto-join; private group → JOIN_REQUEST;
 *    hidden+private → JOIN_REQUEST (hidden does NOT block join);
 *    ORGANIZATION target requires Root Group
 *  - cancelInvitation(): inviter can, ADMIN can, OWNER can, MEMBER cannot;
 *    already-cancelled → REQUEST_NOT_PENDING
 *  - createInvitation(): MEMBER blocked when memberInvitesAllowed=false;
 *    ADMIN/OWNER always allowed
 */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { GroupBan } from './entities/group-ban.entity';
import { Group } from './entities/group.entity';
import { GroupMembership } from './entities/group-membership.entity';
import { MembershipRequest } from './entities/membership-request.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipRequestStatus } from './enums/membership-request-status.enum';
import { MembershipRequestTarget } from './enums/membership-request-target.enum';
import { MembershipRequestType } from './enums/membership-request-type.enum';
import { AuditLogService } from './audit-log.service';
import { GroupHierarchyService } from './group-hierarchy.service';
import { MembershipRequestsService } from './membership-requests.service';
import { RoleAssignmentsService } from './role-assignments.service';

// ─── Builders ────────────────────────────────────────────────────────────────

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'test@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Capoeira Group';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  group.isPublic = true;
  group.isHidden = false;
  group.memberInvitesAllowed = false;
  return Object.assign(group, overrides);
}

function buildMembership(
  overrides: Partial<GroupMembership> = {},
): GroupMembership {
  const membership = new GroupMembership();
  membership.id = 'membership-1';
  membership.status = GroupMembershipStatus.ACTIVE;
  membership.rootGroup = buildGroup();
  membership.user = buildUser();
  membership.joinedAt = new Date('2026-01-01T00:00:00.000Z');
  return Object.assign(membership, overrides);
}

function buildInvitation(
  overrides: Partial<MembershipRequest> = {},
): MembershipRequest {
  const req = new MembershipRequest();
  req.id = 'req-1';
  req.type = MembershipRequestType.INVITATION;
  req.targetType = MembershipRequestTarget.GROUP;
  req.status = MembershipRequestStatus.PENDING;
  req.targetGroup = buildGroup();
  req.initiatedBy = buildUser({ id: 'inviter-1' });
  req.invitedUser = buildUser({ id: 'invitee-1' });
  req.invitedEmail = null;
  req.processedAt = null;
  req.processedBy = null;
  return Object.assign(req, overrides);
}

// ─── Mock EM factory ─────────────────────────────────────────────────────────

interface MockRouting {
  groupResults?: (Group | null)[];
  membershipResults?: (GroupMembership | null)[];
  membershipRequestResults?: (MembershipRequest | null)[];
  roleAssignmentResults?: (RoleAssignment | null)[];
  // Bulk find() results for MembershipRequest - static, not a FIFO queue.
  membershipRequestFindResults?: MembershipRequest[];
  flushError?: Error;
}

function buildMockEm(routing: MockRouting = {}) {
  const groupQueue = [...(routing.groupResults ?? [])];
  const membershipQueue = [...(routing.membershipResults ?? [])];
  const requestQueue = [...(routing.membershipRequestResults ?? [])];
  const roleAssignmentQueue = [...(routing.roleAssignmentResults ?? [])];

  const flush = routing.flushError
    ? jest.fn().mockRejectedValue(routing.flushError)
    : jest.fn().mockResolvedValue(undefined);

  const persist = jest.fn();

  const findOne = jest.fn(
    (entity: unknown, _filter?: unknown, _options?: unknown) => {
      if (entity === Group) return Promise.resolve(groupQueue.shift() ?? null);
      if (entity === GroupMembership)
        return Promise.resolve(membershipQueue.shift() ?? null);
      if (entity === MembershipRequest)
        return Promise.resolve(requestQueue.shift() ?? null);
      if (entity === RoleAssignment)
        return Promise.resolve(roleAssignmentQueue.shift() ?? null);
      return Promise.resolve(null);
    },
  );

  const find = jest.fn((entity: unknown) => {
    if (entity === MembershipRequest) {
      return Promise.resolve(routing.membershipRequestFindResults ?? []);
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
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as unknown as EntityManager),
      ),
  };

  return { em: raw as unknown as EntityManager, persist, findOne, find, flush };
}

// ─── Service factory ─────────────────────────────────────────────────────────

function buildService(em: EntityManager) {
  const groupHierarchyService = {
    getRootGroup: jest.fn().mockResolvedValue(buildGroup()),
  } as unknown as GroupHierarchyService;

  const roleAssignmentsService = {
    ensureMemberRole: jest.fn().mockResolvedValue(undefined),
    resolveAuthorization: jest.fn().mockResolvedValue(null),
  } as unknown as RoleAssignmentsService;

  const auditLogService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;

  const service = new MembershipRequestsService(
    em,
    groupHierarchyService,
    roleAssignmentsService,
    auditLogService,
  );

  return {
    service,
    groupHierarchyService,
    roleAssignmentsService,
    auditLogService,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MembershipRequestsService', () => {
  // ─── join() ────────────────────────────────────────────────────────────

  describe('join()', () => {
    it('auto-joins a public Group immediately and returns { joined: true }', async () => {
      const rootGroup = buildGroup({ id: 'root-1', isPublic: true });
      const { em, persist } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [null], // assertNotAlreadyJoined: no membership
        // fulfillJoin reads existing membership to avoid duplicate
      });
      const { service, roleAssignmentsService } = buildService(em);
      const user = buildUser();

      const result = await service.join(
        'root-1',
        MembershipRequestTarget.GROUP,
        user,
      );

      expect(result).toEqual({ joined: true });
      expect(persist).toHaveBeenCalled();
      expect(roleAssignmentsService.ensureMemberRole).toHaveBeenCalled();
    });

    it('creates a PENDING JOIN_REQUEST for a private (isPublic=false) Group', async () => {
      const privateGroup = buildGroup({ id: 'root-1', isPublic: false });
      const { em, persist, flush } = buildMockEm({
        groupResults: [privateGroup],
        membershipResults: [null], // assertNotAlreadyJoined: no membership
      });
      const { service } = buildService(em);
      const user = buildUser();

      const result = await service.join(
        'root-1',
        MembershipRequestTarget.GROUP,
        user,
      );

      expect(result).toMatchObject({
        type: MembershipRequestType.JOIN_REQUEST,
      });
      const persistedRequest = persist.mock.calls[0]?.[0] as MembershipRequest;
      expect(persistedRequest).toBeInstanceOf(MembershipRequest);
      expect(persistedRequest.type).toBe(MembershipRequestType.JOIN_REQUEST);
      expect(persistedRequest.status).toBe(MembershipRequestStatus.PENDING);
      expect(flush).toHaveBeenCalled();
    });

    it('creates a JOIN_REQUEST for a hidden+private Group (isHidden=true does NOT block join)', async () => {
      // isHidden means "not discoverable via search" — it has no effect on
      // whether a user can join when they have the direct link / publicCode.
      const hiddenPrivate = buildGroup({
        id: 'hidden-group',
        isPublic: false,
        isHidden: true,
      });
      const { em, persist } = buildMockEm({
        groupResults: [hiddenPrivate],
        membershipResults: [null],
      });
      const { service } = buildService(em);

      const result = await service.join(
        'hidden-group',
        MembershipRequestTarget.GROUP,
        buildUser(),
      );

      expect(result).toMatchObject({
        type: MembershipRequestType.JOIN_REQUEST,
      });
      const persisted = persist.mock.calls[0]?.[0] as MembershipRequest;
      expect(persisted).toBeInstanceOf(MembershipRequest);
    });

    it('rejects with NOT_A_ROOT_GROUP when targetType=ORGANIZATION targets a Child Group', async () => {
      const childGroup = buildGroup({
        id: 'child-1',
        parentGroup: buildGroup({ id: 'root-1' }),
        isPublic: true,
      });
      const { em } = buildMockEm({ groupResults: [childGroup] });
      const { service } = buildService(em);

      await expect(
        service.join(
          'child-1',
          MembershipRequestTarget.ORGANIZATION,
          buildUser(),
        ),
      ).rejects.toMatchObject({ response: { code: 'NOT_A_ROOT_GROUP' } });
    });

    it('rejects with ALREADY_MEMBER when user already has an active Membership (ORGANIZATION target)', async () => {
      const rootGroup = buildGroup({ isPublic: true });
      const existingMembership = buildMembership({ rootGroup });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [existingMembership],
      });
      const { service } = buildService(em);

      await expect(
        service.join(
          'group-1',
          MembershipRequestTarget.ORGANIZATION,
          buildUser(),
        ),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_MEMBER' } });
    });

    it('rejects with ALREADY_GROUP_MEMBER when user already has MEMBER Role in the group', async () => {
      const rootGroup = buildGroup({ isPublic: true });
      const existingMembership = buildMembership({ rootGroup });
      const existingRole = new RoleAssignment();
      existingRole.id = 'ra-1';
      existingRole.role = GroupRole.MEMBER;
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [existingMembership],
        roleAssignmentResults: [existingRole],
      });
      const { service } = buildService(em);

      await expect(
        service.join('group-1', MembershipRequestTarget.GROUP, buildUser()),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_GROUP_MEMBER' } });
    });

    it('rejects with GROUP_NOT_FOUND when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const { service } = buildService(em);

      await expect(
        service.join('missing', MembershipRequestTarget.GROUP, buildUser()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with GROUP_ARCHIVED for an archived group', async () => {
      const archived = buildGroup({ status: GroupStatus.ARCHIVED });
      const { em } = buildMockEm({ groupResults: [archived] });
      const { service } = buildService(em);

      await expect(
        service.join('group-1', MembershipRequestTarget.GROUP, buildUser()),
      ).rejects.toMatchObject({ response: { code: 'GROUP_ARCHIVED' } });
    });
  });

  // ─── cancelInvitation() ────────────────────────────────────────────────

  describe('cancelInvitation()', () => {
    it('allows the original inviter to cancel their own invitation', async () => {
      const inviter = buildUser({ id: 'inviter-1' });
      const invitation = buildInvitation({ initiatedBy: inviter });
      const { em, flush } = buildMockEm({
        membershipRequestResults: [invitation],
      });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('req-1', inviter, []),
      ).resolves.toBeUndefined();
      expect(flush).toHaveBeenCalled();
      expect(invitation.status).toBe(MembershipRequestStatus.CANCELLED);
    });

    it('allows an ADMIN to cancel an invitation created by someone else', async () => {
      const inviter = buildUser({ id: 'inviter-1' });
      const admin = buildUser({ id: 'admin-1' });
      const invitation = buildInvitation({ initiatedBy: inviter });
      const { em, flush } = buildMockEm({
        membershipRequestResults: [invitation],
      });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('req-1', admin, [GroupRole.ADMIN]),
      ).resolves.toBeUndefined();
      expect(flush).toHaveBeenCalled();
      expect(invitation.status).toBe(MembershipRequestStatus.CANCELLED);
    });

    it('allows an OWNER to cancel an invitation created by someone else', async () => {
      const inviter = buildUser({ id: 'inviter-1' });
      const owner = buildUser({ id: 'owner-1' });
      const invitation = buildInvitation({ initiatedBy: inviter });
      const { em, flush } = buildMockEm({
        membershipRequestResults: [invitation],
      });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('req-1', owner, [GroupRole.OWNER]),
      ).resolves.toBeUndefined();
      expect(flush).toHaveBeenCalled();
    });

    it("rejects with INSUFFICIENT_PERMISSIONS_TO_CANCEL_INVITATION when a plain MEMBER tries to cancel someone else's invitation", async () => {
      const inviter = buildUser({ id: 'inviter-1' });
      const otherMember = buildUser({ id: 'member-2' });
      const invitation = buildInvitation({ initiatedBy: inviter });
      const { em } = buildMockEm({
        membershipRequestResults: [invitation],
      });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('req-1', otherMember, [GroupRole.MEMBER]),
      ).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_PERMISSIONS_TO_CANCEL_INVITATION' },
      });
      expect(invitation.status).toBe(MembershipRequestStatus.PENDING);
    });

    it('rejects with INSUFFICIENT_PERMISSIONS_TO_CANCEL_INVITATION for INSTRUCTOR/ASSISTANT (non-inviter)', async () => {
      const inviter = buildUser({ id: 'inviter-1' });
      const instructor = buildUser({ id: 'instructor-1' });
      const invitation = buildInvitation({ initiatedBy: inviter });
      const { em } = buildMockEm({
        membershipRequestResults: [invitation],
      });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('req-1', instructor, [GroupRole.INSTRUCTOR]),
      ).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_PERMISSIONS_TO_CANCEL_INVITATION' },
      });
    });

    it('rejects with REQUEST_NOT_PENDING when the invitation is already cancelled', async () => {
      const inviter = buildUser({ id: 'inviter-1' });
      const cancelledInvitation = buildInvitation({
        initiatedBy: inviter,
        status: MembershipRequestStatus.CANCELLED,
      });
      const { em } = buildMockEm({
        membershipRequestResults: [cancelledInvitation],
      });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('req-1', inviter, []),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_NOT_PENDING' } });
    });

    it('rejects with NOT_AN_INVITATION when the request is a JOIN_REQUEST', async () => {
      const actor = buildUser({ id: 'actor-1' });
      const joinRequest = buildInvitation({
        initiatedBy: actor,
        type: MembershipRequestType.JOIN_REQUEST,
      });
      const { em } = buildMockEm({
        membershipRequestResults: [joinRequest],
      });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('req-1', actor, [GroupRole.OWNER]),
      ).rejects.toMatchObject({ response: { code: 'NOT_AN_INVITATION' } });
    });

    it('rejects with MEMBERSHIP_REQUEST_NOT_FOUND when the request does not exist', async () => {
      const { em } = buildMockEm({ membershipRequestResults: [null] });
      const { service } = buildService(em);

      await expect(
        service.cancelInvitation('missing', buildUser(), [GroupRole.OWNER]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── createInvitation() ────────────────────────────────────────────────

  describe('createInvitation()', () => {
    it('rejects with MEMBER_INVITES_NOT_ALLOWED when memberInvitesAllowed=false and caller is MEMBER', async () => {
      const group = buildGroup({ memberInvitesAllowed: false });
      const { em } = buildMockEm({ groupResults: [group] });
      const { service } = buildService(em);

      await expect(
        service.createInvitation(
          'group-1',
          {
            targetType: MembershipRequestTarget.GROUP,
            invitedUserId: 'user-2',
            invitedEmail: null,
          },
          buildUser({ id: 'inviter-1' }),
          [GroupRole.MEMBER],
          GroupMembershipStatus.ACTIVE,
        ),
      ).rejects.toMatchObject({
        response: { code: 'MEMBER_INVITES_NOT_ALLOWED' },
      });
    });

    it('allows ADMIN to invite regardless of memberInvitesAllowed setting', async () => {
      const group = buildGroup({ memberInvitesAllowed: false });
      const invitee = buildUser({
        id: 'invitee-1',
        email: 'invitee@example.com',
      });
      const { em } = buildMockEm({
        groupResults: [group],
        // findOne(User) for the invitedUserId lookup
        membershipResults: [null],
      });
      // override findOne to return the invitee for User lookup
      const {
        em: emWithUser,
        persist,
        flush,
      } = buildMockEm({
        groupResults: [group],
        membershipResults: [null], // assertNotAlreadyJoined
      });
      (
        emWithUser as never as { findOne: jest.Mock }
      ).findOne.mockImplementation((entity: unknown, filter?: unknown) => {
        if (entity === Group) return Promise.resolve(group);
        if (entity === GroupMembership) return Promise.resolve(null);
        if (entity === MembershipRequest) return Promise.resolve(null);
        if (entity === RoleAssignment) return Promise.resolve(null);
        if (entity === GroupBan) return Promise.resolve(null);
        // User lookup for invitedUserId
        return Promise.resolve(invitee);
      });
      const { service } = buildService(emWithUser);

      await expect(
        service.createInvitation(
          'group-1',
          {
            targetType: MembershipRequestTarget.GROUP,
            invitedUserId: 'invitee-1',
            invitedEmail: null,
          },
          buildUser({ id: 'admin-1' }),
          [GroupRole.ADMIN],
          GroupMembershipStatus.ACTIVE,
        ),
      ).resolves.toMatchObject({ type: MembershipRequestType.INVITATION });
    });

    it('rejects with INVITATION_RECIPIENT_REQUIRED when neither invitedUserId nor invitedEmail provided', async () => {
      const group = buildGroup({ memberInvitesAllowed: true });
      const { em } = buildMockEm({ groupResults: [group] });
      const { service } = buildService(em);

      await expect(
        service.createInvitation(
          'group-1',
          {
            targetType: MembershipRequestTarget.GROUP,
            invitedUserId: null,
            invitedEmail: null,
          },
          buildUser({ id: 'admin-1' }),
          [GroupRole.ADMIN],
          GroupMembershipStatus.ACTIVE,
        ),
      ).rejects.toMatchObject({
        response: { code: 'INVITATION_RECIPIENT_REQUIRED' },
      });
    });
  });

  // ─── withdrawMyJoinRequest() ───────────────────────────────────────────

  describe('withdrawMyJoinRequest()', () => {
    it("cancels the caller's PENDING JOIN_REQUEST for the group", async () => {
      const user = buildUser();
      const joinRequest = new MembershipRequest();
      joinRequest.id = 'req-1';
      joinRequest.type = MembershipRequestType.JOIN_REQUEST;
      joinRequest.status = MembershipRequestStatus.PENDING;
      joinRequest.processedAt = null;
      joinRequest.processedBy = null;
      const { em, flush } = buildMockEm({
        membershipRequestResults: [joinRequest],
      });
      const { service } = buildService(em);

      await expect(
        service.withdrawMyJoinRequest('group-1', user),
      ).resolves.toBeUndefined();
      expect(flush).toHaveBeenCalled();
      expect(joinRequest.status).toBe(MembershipRequestStatus.CANCELLED);
    });

    it('rejects with JOIN_REQUEST_NOT_FOUND when no PENDING request exists', async () => {
      const { em } = buildMockEm({ membershipRequestResults: [null] });
      const { service } = buildService(em);

      await expect(
        service.withdrawMyJoinRequest('group-1', buildUser()),
      ).rejects.toMatchObject({ response: { code: 'JOIN_REQUEST_NOT_FOUND' } });
    });
  });

  describe('listJoinRequestsForGroups()', () => {
    it('returns PENDING join requests across every given target group in one query', async () => {
      const requestForGroupOne = buildInvitation({
        id: 'req-1',
        type: MembershipRequestType.JOIN_REQUEST,
        targetGroup: buildGroup({ id: 'group-1' }),
      });
      const requestForGroupTwo = buildInvitation({
        id: 'req-2',
        type: MembershipRequestType.JOIN_REQUEST,
        targetGroup: buildGroup({ id: 'group-2' }),
      });
      const { em, find } = buildMockEm({
        membershipRequestFindResults: [requestForGroupOne, requestForGroupTwo],
      });
      const { service } = buildService(em);

      const result = await service.listJoinRequestsForGroups([
        'group-1',
        'group-2',
      ]);

      expect(result.map((request) => request.id)).toEqual(['req-1', 'req-2']);
      expect(find).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array without querying when given no group ids', async () => {
      const { em, find } = buildMockEm();
      const { service } = buildService(em);

      const result = await service.listJoinRequestsForGroups([]);

      expect(result).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });
  });
});
