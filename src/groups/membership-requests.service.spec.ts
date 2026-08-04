/**
 * Unit tests for MembershipRequestsService.
 *
 * Covers (post Membership/RoleAssignments/Permissions rebuild - Section is
 * the only target with membership, Group is always rejected):
 *  - join(): GROUP target always rejected (GROUP_HAS_NO_MEMBERSHIP);
 *    public Section → auto-join; private Section → JOIN_REQUEST;
 *    hidden+private → JOIN_REQUEST (hidden does NOT block join)
 *  - cancelInvitation(): inviter can, ADMIN can, OWNER can, MEMBER cannot;
 *    already-cancelled → REQUEST_NOT_PENDING
 *  - createInvitation(): GROUP target always rejected; MEMBER blocked when
 *    memberInvitesAllowed=false; ADMIN/OWNER always allowed
 */

import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { SectionBan } from './entities/section-ban.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { MembershipRequest } from './entities/membership-request.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipRequestStatus } from './enums/membership-request-status.enum';
import { MembershipRequestTarget } from './enums/membership-request-target.enum';
import { MembershipRequestType } from './enums/membership-request-type.enum';
import { AuditLogService } from './audit-log.service';
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

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Capoeira Section';
  section.status = GroupStatus.ACTIVE;
  section.isPublic = true;
  section.isHidden = false;
  section.memberInvitesAllowed = false;
  return Object.assign(section, overrides);
}

function buildMembership(
  overrides: Partial<SectionMembership> = {},
): SectionMembership {
  const membership = new SectionMembership();
  membership.id = 'membership-1';
  membership.status = SectionMembershipStatus.ACTIVE;
  membership.section = buildSection();
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
  req.targetType = MembershipRequestTarget.SECTION;
  req.status = MembershipRequestStatus.PENDING;
  req.targetSection = buildSection();
  req.initiatedBy = buildUser({ id: 'inviter-1' });
  req.invitedUser = buildUser({ id: 'invitee-1' });
  req.invitedEmail = null;
  req.processedAt = null;
  req.processedBy = null;
  return Object.assign(req, overrides);
}

// ─── Mock EM factory ─────────────────────────────────────────────────────────

interface MockRouting {
  sectionResults?: (Section | null)[];
  membershipResults?: (SectionMembership | null)[];
  membershipRequestResults?: (MembershipRequest | null)[];
  banResults?: (SectionBan | null)[];
  userResult?: User | null;
  // Bulk find() results for MembershipRequest - static, not a FIFO queue.
  membershipRequestFindResults?: MembershipRequest[];
  flushError?: Error;
}

function buildMockEm(routing: MockRouting = {}) {
  const sectionQueue = [...(routing.sectionResults ?? [])];
  const membershipQueue = [...(routing.membershipResults ?? [])];
  const requestQueue = [...(routing.membershipRequestResults ?? [])];
  const banQueue = [...(routing.banResults ?? [])];

  const flush = routing.flushError
    ? jest.fn().mockRejectedValue(routing.flushError)
    : jest.fn().mockResolvedValue(undefined);

  const persist = jest.fn<void, [unknown]>();

  const findOne = jest.fn((entity: unknown) => {
    if (entity === Section)
      return Promise.resolve(sectionQueue.shift() ?? null);
    if (entity === SectionMembership)
      return Promise.resolve(membershipQueue.shift() ?? null);
    if (entity === MembershipRequest)
      return Promise.resolve(requestQueue.shift() ?? null);
    if (entity === SectionBan) return Promise.resolve(banQueue.shift() ?? null);
    if (entity === User) return Promise.resolve(routing.userResult ?? null);
    return Promise.resolve(null);
  });

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
  const insertRoleAssignment = jest
    .fn()
    .mockResolvedValue(new RoleAssignment());
  const roleAssignmentsService = {
    insertRoleAssignment,
    resolveAuthorization: jest.fn().mockResolvedValue(null),
  } as unknown as RoleAssignmentsService;

  const auditLogService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;

  const service = new MembershipRequestsService(
    em,
    roleAssignmentsService,
    auditLogService,
  );

  return {
    service,
    roleAssignmentsService,
    insertRoleAssignment,
    auditLogService,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MembershipRequestsService', () => {
  // ─── join() ────────────────────────────────────────────────────────────

  describe('join()', () => {
    it('rejects a GROUP target unconditionally with GROUP_HAS_NO_MEMBERSHIP, without touching the database', async () => {
      const { em, findOne } = buildMockEm();
      const { service } = buildService(em);

      await expect(
        service.join('group-1', MembershipRequestTarget.GROUP, buildUser()),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_HAS_NO_MEMBERSHIP' },
      });
      expect(findOne).not.toHaveBeenCalled();
    });

    it('auto-joins a public Section immediately, creating membership and MEMBER atomically', async () => {
      const section = buildSection({ id: 'section-1', isPublic: true });
      const { em, persist } = buildMockEm({
        sectionResults: [section],
        membershipResults: [null], // assertNotAlreadyJoined, then fulfillJoin's own check
      });
      const { service, insertRoleAssignment } = buildService(em);
      const user = buildUser();

      const result = await service.join(
        'section-1',
        MembershipRequestTarget.SECTION,
        user,
      );

      expect(result).toEqual({ joined: true });
      expect(persist).toHaveBeenCalled();
      expect(insertRoleAssignment).toHaveBeenCalledWith(
        em,
        user,
        section,
        GroupRole.MEMBER,
        user,
      );
    });

    it('creates a PENDING JOIN_REQUEST for a private (isPublic=false) Section', async () => {
      const privateSection = buildSection({ id: 'section-1', isPublic: false });
      const { em, persist, flush } = buildMockEm({
        sectionResults: [privateSection],
        membershipResults: [null],
      });
      const { service } = buildService(em);
      const user = buildUser();

      const result = await service.join(
        'section-1',
        MembershipRequestTarget.SECTION,
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

    it('creates a JOIN_REQUEST for a hidden+private Section (isHidden=true does NOT block join)', async () => {
      const hiddenPrivate = buildSection({
        id: 'hidden-section',
        isPublic: false,
        isHidden: true,
      });
      const { em, persist } = buildMockEm({
        sectionResults: [hiddenPrivate],
        membershipResults: [null],
      });
      const { service } = buildService(em);

      const result = await service.join(
        'hidden-section',
        MembershipRequestTarget.SECTION,
        buildUser(),
      );

      expect(result).toMatchObject({
        type: MembershipRequestType.JOIN_REQUEST,
      });
      const persisted = persist.mock.calls[0]?.[0] as MembershipRequest;
      expect(persisted).toBeInstanceOf(MembershipRequest);
    });

    it('rejects with ALREADY_MEMBER when the user already has an active SectionMembership', async () => {
      const section = buildSection({ isPublic: true });
      const existingMembership = buildMembership({ section });
      const { em } = buildMockEm({
        sectionResults: [section],
        membershipResults: [existingMembership],
      });
      const { service } = buildService(em);

      await expect(
        service.join('section-1', MembershipRequestTarget.SECTION, buildUser()),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_MEMBER' } });
    });

    it('rejects with SECTION_NOT_FOUND when the section does not exist', async () => {
      const { em } = buildMockEm({ sectionResults: [null] });
      const { service } = buildService(em);

      await expect(
        service.join('missing', MembershipRequestTarget.SECTION, buildUser()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with GROUP_ARCHIVED for an archived section', async () => {
      const archived = buildSection({ status: GroupStatus.ARCHIVED });
      const { em } = buildMockEm({ sectionResults: [archived] });
      const { service } = buildService(em);

      await expect(
        service.join('section-1', MembershipRequestTarget.SECTION, buildUser()),
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
    it('rejects a GROUP target unconditionally with GROUP_HAS_NO_MEMBERSHIP, without touching the database', async () => {
      const { em, findOne } = buildMockEm();
      const { service } = buildService(em);

      await expect(
        service.createInvitation(
          'group-1',
          {
            targetType: MembershipRequestTarget.GROUP,
            invitedUserId: 'user-2',
            invitedEmail: null,
          },
          buildUser({ id: 'admin-1' }),
          [GroupRole.ADMIN],
          SectionMembershipStatus.ACTIVE,
        ),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_HAS_NO_MEMBERSHIP' },
      });
      expect(findOne).not.toHaveBeenCalled();
    });

    it('rejects with MEMBER_INVITES_NOT_ALLOWED when memberInvitesAllowed=false and caller is MEMBER', async () => {
      const section = buildSection({ memberInvitesAllowed: false });
      const { em } = buildMockEm({ sectionResults: [section] });
      const { service } = buildService(em);

      await expect(
        service.createInvitation(
          'section-1',
          {
            targetType: MembershipRequestTarget.SECTION,
            invitedUserId: 'user-2',
            invitedEmail: null,
          },
          buildUser({ id: 'inviter-1' }),
          [GroupRole.MEMBER],
          SectionMembershipStatus.ACTIVE,
        ),
      ).rejects.toMatchObject({
        response: { code: 'MEMBER_INVITES_NOT_ALLOWED' },
      });
    });

    it('allows ADMIN to invite regardless of memberInvitesAllowed setting', async () => {
      const section = buildSection({ memberInvitesAllowed: false });
      const invitee = buildUser({
        id: 'invitee-1',
        email: 'invitee@example.com',
      });
      const { em } = buildMockEm({
        sectionResults: [section],
        membershipResults: [null], // assertNotAlreadyJoined
        userResult: invitee,
      });
      const { service } = buildService(em);

      await expect(
        service.createInvitation(
          'section-1',
          {
            targetType: MembershipRequestTarget.SECTION,
            invitedUserId: 'invitee-1',
            invitedEmail: null,
          },
          buildUser({ id: 'admin-1' }),
          [GroupRole.ADMIN],
          SectionMembershipStatus.ACTIVE,
        ),
      ).resolves.toMatchObject({ type: MembershipRequestType.INVITATION });
    });

    it('rejects with INVITATION_RECIPIENT_REQUIRED when neither invitedUserId nor invitedEmail provided', async () => {
      const section = buildSection({ memberInvitesAllowed: true });
      const { em } = buildMockEm({ sectionResults: [section] });
      const { service } = buildService(em);

      await expect(
        service.createInvitation(
          'section-1',
          {
            targetType: MembershipRequestTarget.SECTION,
            invitedUserId: null,
            invitedEmail: null,
          },
          buildUser({ id: 'admin-1' }),
          [GroupRole.ADMIN],
          SectionMembershipStatus.ACTIVE,
        ),
      ).rejects.toMatchObject({
        response: { code: 'INVITATION_RECIPIENT_REQUIRED' },
      });
    });
  });

  // ─── withdrawMyJoinRequest() ───────────────────────────────────────────

  describe('withdrawMyJoinRequest()', () => {
    it("cancels the caller's PENDING JOIN_REQUEST for the section", async () => {
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
        service.withdrawMyJoinRequest('section-1', user),
      ).resolves.toBeUndefined();
      expect(flush).toHaveBeenCalled();
      expect(joinRequest.status).toBe(MembershipRequestStatus.CANCELLED);
    });

    it('rejects with JOIN_REQUEST_NOT_FOUND when no PENDING request exists', async () => {
      const { em } = buildMockEm({ membershipRequestResults: [null] });
      const { service } = buildService(em);

      await expect(
        service.withdrawMyJoinRequest('section-1', buildUser()),
      ).rejects.toMatchObject({ response: { code: 'JOIN_REQUEST_NOT_FOUND' } });
    });
  });

  describe('listJoinRequestsForGroups()', () => {
    it('returns PENDING join requests across every given target section in one query', async () => {
      const requestForSectionOne = buildInvitation({
        id: 'req-1',
        type: MembershipRequestType.JOIN_REQUEST,
        targetSection: buildSection({ id: 'section-1' }),
      });
      const requestForSectionTwo = buildInvitation({
        id: 'req-2',
        type: MembershipRequestType.JOIN_REQUEST,
        targetSection: buildSection({ id: 'section-2' }),
      });
      const { em, find } = buildMockEm({
        membershipRequestFindResults: [
          requestForSectionOne,
          requestForSectionTwo,
        ],
      });
      const { service } = buildService(em);

      const result = await service.listJoinRequestsForGroups([
        'section-1',
        'section-2',
      ]);

      expect(result.map((request) => request.id)).toEqual(['req-1', 'req-2']);
      expect(find).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array without querying when given no section ids', async () => {
      const { em, find } = buildMockEm();
      const { service } = buildService(em);

      const result = await service.listJoinRequestsForGroups([]);

      expect(result).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });
  });
});
