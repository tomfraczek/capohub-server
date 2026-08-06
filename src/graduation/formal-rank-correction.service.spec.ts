import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Collection } from '@mikro-orm/core';
import { AuditLogService } from '../groups/audit-log.service';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { Group } from '../groups/entities/group.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { Section } from '../groups/entities/section.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { User } from '../users/entities/user.entity';
import { CustomUserRank } from './entities/custom-user-rank.entity';
import { FormalRankAssignment } from './entities/formal-rank-assignment.entity';
import { FormalRankCorrectionRequest } from './entities/formal-rank-correction-request.entity';
import { GraduationSystem } from './entities/graduation-system.entity';
import { Rank } from './entities/rank.entity';
import { FormalRankCorrectionStatus } from './enums/formal-rank-correction-status.enum';
import { RankTrack } from './enums/rank-track.enum';
import { FormalRankCorrectionService } from './formal-rank-correction.service';

function buildUser(id: string, displayName = 'Someone'): User {
  const user = new User();
  user.id = id;
  user.displayName = displayName;
  return user;
}

function buildRank(overrides: Partial<Rank> = {}): Rank {
  const group = new Group();
  group.id = 'group-1';
  const system = new GraduationSystem();
  system.id = 'system-1';
  system.group = group;
  system.isActive = true;

  const rank = new Rank();
  rank.id = 'rank-1';
  rank.name = 'Corda Verde';
  rank.track = RankTrack.ADULT;
  rank.system = system;
  rank.isArchived = false;
  rank.cordSegments = new Collection<never>(rank);
  return Object.assign(rank, overrides);
}

function buildAssignment(
  overrides: Partial<FormalRankAssignment> = {},
): FormalRankAssignment {
  const group = new Group();
  group.id = 'group-1';
  const assignment = new FormalRankAssignment();
  assignment.id = 'assignment-1';
  assignment.user = buildUser('target-1');
  assignment.rank = buildRank();
  assignment.sourceGroup = group;
  assignment.endedOn = null;
  return Object.assign(assignment, overrides);
}

function buildFormalGroup(groupId = 'group-1'): FormalGroupAffiliation {
  const group = new Group();
  group.id = groupId;
  const affiliation = new FormalGroupAffiliation();
  affiliation.group = group;
  affiliation.endedOn = null;
  return affiliation;
}

function buildRequest(
  overrides: Partial<FormalRankCorrectionRequest> = {},
): FormalRankCorrectionRequest {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Section One';

  const request = new FormalRankCorrectionRequest();
  request.id = 'request-1';
  request.formalRankAssignment = buildAssignment();
  request.targetUser = buildUser('target-1');
  request.section = section;
  request.reportedBy = buildUser('admin-1', 'Admin One');
  request.status = FormalRankCorrectionStatus.CORRECTION_REQUIRED;
  return Object.assign(request, overrides);
}

interface MockRouting {
  targetUser?: User | null;
  targetMembership?: SectionMembership | null;
  assignment?: FormalRankAssignment | null;
  formalGroup?: FormalGroupAffiliation | null;
  existingActiveRequest?: FormalRankCorrectionRequest | null;
  correctionRequest?: FormalRankCorrectionRequest | null;
  rank?: Rank | null;
  sectionOwner?: RoleAssignment | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });
  const getReference = jest.fn((entityClass: unknown, id: string) => {
    if (entityClass === Section) {
      const section = new Section();
      section.id = id;
      section.name = 'Section One';
      return section;
    }
    return { id };
  });

  const findOne = jest.fn((entityClass: unknown) => {
    if (entityClass === User) {
      return Promise.resolve(
        routing.targetUser === undefined ? null : routing.targetUser,
      );
    }
    if (entityClass === SectionMembership) {
      return Promise.resolve(
        routing.targetMembership === undefined
          ? null
          : routing.targetMembership,
      );
    }
    if (entityClass === FormalRankAssignment) {
      return Promise.resolve(
        routing.assignment === undefined ? null : routing.assignment,
      );
    }
    if (entityClass === FormalGroupAffiliation) {
      return Promise.resolve(
        routing.formalGroup === undefined ? null : routing.formalGroup,
      );
    }
    if (entityClass === FormalRankCorrectionRequest) {
      // request() checks for an existing active request; submit/approve/
      // reject look up the request being acted on - distinguished by
      // which fixture the test supplies.
      if (routing.correctionRequest !== undefined) {
        return Promise.resolve(routing.correctionRequest);
      }
      return Promise.resolve(
        routing.existingActiveRequest === undefined
          ? null
          : routing.existingActiveRequest,
      );
    }
    if (entityClass === Rank) {
      return Promise.resolve(routing.rank === undefined ? null : routing.rank);
    }
    if (entityClass === RoleAssignment) {
      return Promise.resolve(
        routing.sectionOwner === undefined ? null : routing.sectionOwner,
      );
    }
    if (entityClass === CustomUserRank) {
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });

  // No-op: every fixture below is already fully "populated" (plain
  // objects with their relations directly assigned), so there is nothing
  // for a real populate() to fetch - this only exists to satisfy
  // loadForReview's post-lock populate() call.
  const populate = jest.fn().mockResolvedValue(undefined);

  const raw: Record<string, unknown> = {
    findOne,
    persist,
    flush,
    getReference,
    populate,
  };
  raw.transactional = jest.fn((cb: (em: unknown) => unknown) => cb(raw));

  return { em: raw as unknown as EntityManager, persist, flush };
}

function buildAuditLogService(): AuditLogService {
  return { record: jest.fn() } as unknown as AuditLogService;
}

function buildRoleAssignmentsService(
  roles: Partial<Record<GroupRole, boolean>> = {},
): RoleAssignmentsService {
  return {
    hasRole: jest.fn((_em, _userId, _sectionId, role: GroupRole) =>
      Promise.resolve(roles[role] ?? false),
    ),
  } as unknown as RoleAssignmentsService;
}

describe('FormalRankCorrectionService', () => {
  describe('request', () => {
    it('rejects a target with no active section membership', async () => {
      const { em } = buildMockEm({
        targetUser: buildUser('target-1'),
        targetMembership: null,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.request(
        'section-1',
        { targetUserId: 'target-1', reason: null },
        buildUser('admin-1'),
      );

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'TARGET_NOT_SECTION_MEMBER' },
      });
    });

    it('rejects a target with no active formal rank', async () => {
      const { em } = buildMockEm({
        targetUser: buildUser('target-1'),
        targetMembership: new SectionMembership(),
        assignment: null,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.request(
        'section-1',
        { targetUserId: 'target-1', reason: null },
        buildUser('admin-1'),
      );

      await expect(promise).rejects.toMatchObject({
        response: { code: 'TARGET_HAS_NO_ACTIVE_FORMAL_RANK' },
      });
    });

    it('rejects a target with no active formal group affiliation', async () => {
      const { em } = buildMockEm({
        targetUser: buildUser('target-1'),
        targetMembership: new SectionMembership(),
        assignment: buildAssignment(),
        formalGroup: null,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.request(
        'section-1',
        { targetUserId: 'target-1', reason: null },
        buildUser('admin-1'),
      );

      await expect(promise).rejects.toMatchObject({
        response: { code: 'TARGET_HAS_NO_ACTIVE_FORMAL_GROUP' },
      });
    });

    it('rejects when the current formal rank does not belong to the current formal group catalog', async () => {
      const { em } = buildMockEm({
        targetUser: buildUser('target-1'),
        targetMembership: new SectionMembership(),
        assignment: buildAssignment(), // rank's system.group is 'group-1'
        formalGroup: buildFormalGroup('group-2'), // different group
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.request(
        'section-1',
        { targetUserId: 'target-1', reason: null },
        buildUser('admin-1'),
      );

      await expect(promise).rejects.toMatchObject({
        response: { code: 'FORMAL_RANK_NOT_IN_CURRENT_CATALOG' },
      });
    });

    it('rejects a duplicate active request for the same assignment', async () => {
      const { em } = buildMockEm({
        targetUser: buildUser('target-1'),
        targetMembership: new SectionMembership(),
        assignment: buildAssignment(),
        formalGroup: buildFormalGroup('group-1'),
        existingActiveRequest: buildRequest(),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.request(
        'section-1',
        { targetUserId: 'target-1', reason: null },
        buildUser('admin-1'),
      );

      await expect(promise).rejects.toMatchObject({
        response: { code: 'CORRECTION_ALREADY_ACTIVE' },
      });
    });

    it('creates a CORRECTION_REQUIRED request when every condition is met', async () => {
      const { em, persist } = buildMockEm({
        targetUser: buildUser('target-1'),
        targetMembership: new SectionMembership(),
        assignment: buildAssignment(),
        formalGroup: buildFormalGroup('group-1'),
        existingActiveRequest: null,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const result = await service.request(
        'section-1',
        { targetUserId: 'target-1', reason: 'Wrong belt recorded' },
        buildUser('admin-1'),
      );

      expect(persist).toHaveBeenCalled();
      expect(result.status).toBe(
        FormalRankCorrectionStatus.CORRECTION_REQUIRED,
      );
      expect(result.reason).toBe('Wrong belt recorded');
      expect(result.proposedRank).toBeNull();
    });
  });

  describe('submit', () => {
    it('throws NO_ACTIVE_CORRECTION when the caller has none', async () => {
      const { em } = buildMockEm({ correctionRequest: null });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.submit(buildUser('target-1'), {
        rankId: 'rank-2',
        awardedByName: null,
      });

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'NO_ACTIVE_CORRECTION' },
      });
    });

    it('rejects a Rank from a different group than the current formal group', async () => {
      const otherGroupRank = buildRank({ id: 'rank-2' });
      otherGroupRank.system.group.id = 'group-2';
      const { em } = buildMockEm({
        assignment: buildAssignment(),
        correctionRequest: buildRequest({
          status: FormalRankCorrectionStatus.CORRECTION_REQUIRED,
        }),
        formalGroup: buildFormalGroup('group-1'),
        rank: otherGroupRank,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.submit(buildUser('target-1'), {
        rankId: 'rank-2',
        awardedByName: null,
      });

      await expect(promise).rejects.toMatchObject({
        response: { code: 'RANK_NOT_IN_FORMAL_GROUP_CATALOG' },
      });
    });

    it('rejects an archived Rank', async () => {
      const { em } = buildMockEm({
        assignment: buildAssignment(),
        correctionRequest: buildRequest({
          status: FormalRankCorrectionStatus.REJECTED,
        }),
        formalGroup: buildFormalGroup('group-1'),
        rank: buildRank({ id: 'rank-2', isArchived: true }),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.submit(buildUser('target-1'), {
        rankId: 'rank-2',
        awardedByName: null,
      });

      await expect(promise).rejects.toMatchObject({
        response: { code: 'RANK_ARCHIVED' },
      });
    });

    it('accepts a valid Rank, moves to PENDING_APPROVAL, and never creates a new FormalRankAssignment', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.CORRECTION_REQUIRED,
      });
      const { em, persist } = buildMockEm({
        assignment: buildAssignment(),
        correctionRequest: request,
        formalGroup: buildFormalGroup('group-1'),
        rank: buildRank({ id: 'rank-2' }),
        sectionOwner: null,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const result = await service.submit(buildUser('target-1'), {
        rankId: 'rank-2',
        awardedByName: 'Mestre Certo',
      });

      expect(result.status).toBe(FormalRankCorrectionStatus.PENDING_APPROVAL);
      expect(result.proposedRank?.id).toBe('rank-2');
      expect(result.submittedAt).not.toBeNull();
      // persist() is only ever called for notification rows here - never
      // for a FormalRankAssignment (the request itself is a managed,
      // already-loaded entity mutated in place, not re-persisted).
      expect(persist).not.toHaveBeenCalledWith(
        expect.any(FormalRankAssignment),
      );
    });
  });

  describe('approve - variant C review authorization', () => {
    it('lets OWNER approve a request reported by someone else', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank: buildRank({ id: 'rank-2' }),
        reportedBy: buildUser('admin-1'),
      });
      const { em } = buildMockEm({
        correctionRequest: request,
        targetMembership: new SectionMembership(),
        formalGroup: buildFormalGroup('group-1'),
        assignment: buildAssignment(),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const result = await service.approve(
        'section-1',
        'request-1',
        buildUser('owner-1'),
      );
      expect(result.status).toBe(FormalRankCorrectionStatus.APPROVED);
    });

    it('lets the reporting ADMIN approve their own report', async () => {
      const reporter = buildUser('admin-1');
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank: buildRank({ id: 'rank-2' }),
        reportedBy: reporter,
      });
      const { em } = buildMockEm({
        correctionRequest: request,
        targetMembership: new SectionMembership(),
        formalGroup: buildFormalGroup('group-1'),
        assignment: buildAssignment(),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.ADMIN]: true }),
        buildAuditLogService(),
      );

      const result = await service.approve('section-1', 'request-1', reporter);
      expect(result.status).toBe(FormalRankCorrectionStatus.APPROVED);
    });

    it('rejects an ADMIN approving a report filed by a different ADMIN', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank: buildRank({ id: 'rank-2' }),
        reportedBy: buildUser('admin-1'),
      });
      const { em } = buildMockEm({ correctionRequest: request });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.ADMIN]: true }),
        buildAuditLogService(),
      );

      const promise = service.approve(
        'section-1',
        'request-1',
        buildUser('admin-2'),
      );

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_REVIEW_PERMISSIONS' },
      });
    });

    it('rejects a caller with neither OWNER nor ADMIN', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank: buildRank({ id: 'rank-2' }),
      });
      const { em } = buildMockEm({ correctionRequest: request });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );

      const promise = service.approve(
        'section-1',
        'request-1',
        buildUser('member-1'),
      );
      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('approve - status/state guards', () => {
    it('rejects approving a request that is not PENDING_APPROVAL', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.CORRECTION_REQUIRED,
      });
      const { em } = buildMockEm({ correctionRequest: request });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const promise = service.approve(
        'section-1',
        'request-1',
        buildUser('owner-1'),
      );
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CORRECTION_NOT_PENDING' },
      });
    });

    it('rejects when the target is no longer an active section member', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank: buildRank({ id: 'rank-2' }),
      });
      const { em } = buildMockEm({
        correctionRequest: request,
        targetMembership: null,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const promise = service.approve(
        'section-1',
        'request-1',
        buildUser('owner-1'),
      );
      await expect(promise).rejects.toMatchObject({
        response: { code: 'TARGET_NOT_SECTION_MEMBER' },
      });
    });

    it('bounces back to CORRECTION_REQUIRED and rejects when the formal group changed since submit', async () => {
      const submittedRank = buildRank({ id: 'rank-2' });
      submittedRank.system.group.id = 'group-1';
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank,
      });
      const { em } = buildMockEm({
        correctionRequest: request,
        targetMembership: new SectionMembership(),
        formalGroup: buildFormalGroup('group-2'), // now a different group
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const promise = service.approve(
        'section-1',
        'request-1',
        buildUser('owner-1'),
      );

      await expect(promise).rejects.toMatchObject({
        response: { code: 'FORMAL_GROUP_CHANGED_REQUIRES_RESUBMISSION' },
      });
      expect(request.status).toBe(
        FormalRankCorrectionStatus.CORRECTION_REQUIRED,
      );
      expect(request.submittedRank).toBeNull();
    });

    it('rejects when the FormalRankAssignment is no longer current (already ended)', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank: buildRank({ id: 'rank-2' }),
      });
      const { em } = buildMockEm({
        correctionRequest: request,
        targetMembership: new SectionMembership(),
        formalGroup: buildFormalGroup('group-1'),
        assignment: buildAssignment({ endedOn: new Date('2020-01-01') }),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const promise = service.approve(
        'section-1',
        'request-1',
        buildUser('owner-1'),
      );
      await expect(promise).rejects.toMatchObject({
        response: { code: 'FORMAL_RANK_ASSIGNMENT_NO_LONGER_CURRENT' },
      });
    });

    it('applies the correction to the same assignment, leaving startedOn/endedOn untouched', async () => {
      const submittedRank = buildRank({ id: 'rank-2', name: 'Corda Azul' });
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank,
        submittedAwardedByName: 'Mestre Certo',
      });
      const assignment = buildAssignment();
      assignment.startedOn = new Date('2019-05-01');
      assignment.awardedByName = 'Old Name';
      const { em } = buildMockEm({
        correctionRequest: request,
        targetMembership: new SectionMembership(),
        formalGroup: buildFormalGroup('group-1'),
        assignment,
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const result = await service.approve(
        'section-1',
        'request-1',
        buildUser('owner-1'),
      );

      expect(assignment.rank.id).toBe('rank-2');
      expect(assignment.awardedByName).toBe('Mestre Certo');
      expect(assignment.startedOn).toEqual(new Date('2019-05-01'));
      expect(assignment.endedOn).toBeNull();
      expect(result.status).toBe(FormalRankCorrectionStatus.APPROVED);
    });
  });

  describe('reject', () => {
    it('rejects a non-PENDING_APPROVAL request', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.CORRECTION_REQUIRED,
      });
      const { em } = buildMockEm({ correctionRequest: request });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const promise = service.reject(
        'section-1',
        'request-1',
        { reason: null },
        buildUser('owner-1'),
      );
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CORRECTION_NOT_PENDING' },
      });
    });

    it('sets REJECTED and preserves the proposed rank for a future resubmission', async () => {
      const submittedRank = buildRank({ id: 'rank-2' });
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank,
      });
      const { em } = buildMockEm({
        correctionRequest: request,
        targetMembership: new SectionMembership(),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.OWNER]: true }),
        buildAuditLogService(),
      );

      const result = await service.reject(
        'section-1',
        'request-1',
        { reason: 'Wrong choice' },
        buildUser('owner-1'),
      );

      expect(result.status).toBe(FormalRankCorrectionStatus.REJECTED);
      expect(result.proposedRank?.id).toBe('rank-2');
      expect(result.rejectionReason).toBe('Wrong choice');
    });

    it('rejects an ADMIN who did not report the request', async () => {
      const request = buildRequest({
        status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        submittedRank: buildRank({ id: 'rank-2' }),
        reportedBy: buildUser('admin-1'),
      });
      const { em } = buildMockEm({ correctionRequest: request });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService({ [GroupRole.ADMIN]: true }),
        buildAuditLogService(),
      );

      const promise = service.reject(
        'section-1',
        'request-1',
        { reason: null },
        buildUser('admin-2'),
      );
      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('isPubliclyVisible', () => {
    it('is false while CORRECTION_REQUIRED', async () => {
      const { em } = buildMockEm({
        correctionRequest: buildRequest({
          status: FormalRankCorrectionStatus.CORRECTION_REQUIRED,
        }),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );
      expect(await service.isPubliclyVisible('assignment-1')).toBe(false);
    });

    it('is false while PENDING_APPROVAL', async () => {
      const { em } = buildMockEm({
        correctionRequest: buildRequest({
          status: FormalRankCorrectionStatus.PENDING_APPROVAL,
        }),
      });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );
      expect(await service.isPubliclyVisible('assignment-1')).toBe(false);
    });

    it('is true when there is no active correction request', async () => {
      const { em } = buildMockEm({ correctionRequest: null });
      const service = new FormalRankCorrectionService(
        em,
        buildRoleAssignmentsService(),
        buildAuditLogService(),
      );
      expect(await service.isPubliclyVisible('assignment-1')).toBe(true);
    });
  });
});
