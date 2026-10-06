import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Collection } from '@mikro-orm/core';
import type { EventAccessService } from '../events/event-access.service';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { Group } from '../groups/entities/group.entity';
import { User } from '../users/entities/user.entity';
import { GraduationSystem } from './entities/graduation-system.entity';
import { Rank } from './entities/rank.entity';
import { FormalRankAssignment } from './entities/formal-rank-assignment.entity';
import { FormalRankRequest } from './entities/formal-rank-request.entity';
import { FormalRankRequestStatus } from './enums/formal-rank-request-status.enum';
import { RankTrack } from './enums/rank-track.enum';
import { FormalRankService } from './formal-rank.service';
import { FormalRankRequestsService } from './formal-rank-requests.service';

// Not exercised in these cases - every setCurrent() call below passes
// eventId: null, so FormalRankService never calls into this service.
function buildMockEventAccessService(): EventAccessService {
  return {
    loadOrFail: jest.fn(),
    isVisibleToViewer: jest.fn(),
  } as unknown as EventAccessService;
}

// Only its notifyReviewers hook is reached (after creating a request).
function buildMockFormalRankRequestsService(): FormalRankRequestsService {
  return {
    notifyReviewers: jest.fn().mockResolvedValue(undefined),
  } as unknown as FormalRankRequestsService;
}

function buildUser(id = 'user-1'): User {
  const user = new User();
  user.id = id;
  return user;
}

function buildFormalGroup(groupId = 'group-1'): FormalGroupAffiliation {
  const group = new Group();
  group.id = groupId;
  const affiliation = new FormalGroupAffiliation();
  affiliation.group = group;
  return affiliation;
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

interface MockRouting {
  activeFormalGroup?: FormalGroupAffiliation | null;
  rank?: Rank | null;
  currentAssignment?: FormalRankAssignment | null;
  // Whether the caller is OWNER/ADMIN of their formal Group (RoleAssignment
  // count) - confirms their own choice immediately.
  administersFormalGroup?: boolean;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entityClass: unknown) => {
    if (entityClass === FormalGroupAffiliation) {
      return Promise.resolve(
        routing.activeFormalGroup === undefined
          ? null
          : routing.activeFormalGroup,
      );
    }
    if (entityClass === Rank) {
      return Promise.resolve(routing.rank === undefined ? null : routing.rank);
    }
    if (entityClass === FormalRankAssignment) {
      return Promise.resolve(
        routing.currentAssignment === undefined
          ? null
          : routing.currentAssignment,
      );
    }
    return Promise.resolve(null);
  });

  const count = jest.fn(() =>
    Promise.resolve(routing.administersFormalGroup ? 1 : 0),
  );
  // No pending FormalRankRequest to cancel in these cases.
  const find = jest.fn(() => Promise.resolve([]));

  const raw: Record<string, unknown> = { findOne, persist, flush, count, find };
  raw.transactional = jest.fn((cb: (em: unknown) => unknown) => cb(raw));

  return { em: raw as unknown as EntityManager, persist, flush };
}

describe('FormalRankService', () => {
  describe('setCurrent', () => {
    it('rejects when the caller has no active formal group', async () => {
      const { em } = buildMockEm({ activeFormalGroup: null });
      const service = new FormalRankService(
        em,
        buildMockEventAccessService(),
        buildMockFormalRankRequestsService(),
      );

      const promise = service.setCurrent(buildUser(), {
        rankId: 'rank-1',
        awardedByName: null,
        eventId: null,
      });

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'FORMAL_RANK_REQUIRES_FORMAL_GROUP' },
      });
    });

    it('rejects an archived rank', async () => {
      const { em } = buildMockEm({
        activeFormalGroup: buildFormalGroup(),
        rank: buildRank({ isArchived: true }),
      });
      const service = new FormalRankService(
        em,
        buildMockEventAccessService(),
        buildMockFormalRankRequestsService(),
      );

      const promise = service.setCurrent(buildUser(), {
        rankId: 'rank-1',
        awardedByName: null,
        eventId: null,
      });

      await expect(promise).rejects.toMatchObject({
        response: { code: 'RANK_ARCHIVED' },
      });
    });

    it('rejects a rank belonging to a different group than the active formal group', async () => {
      const { em } = buildMockEm({
        activeFormalGroup: buildFormalGroup('group-2'),
        rank: buildRank({}),
      });
      const service = new FormalRankService(
        em,
        buildMockEventAccessService(),
        buildMockFormalRankRequestsService(),
      );

      const promise = service.setCurrent(buildUser(), {
        rankId: 'rank-1',
        awardedByName: null,
        eventId: null,
      });

      await expect(promise).rejects.toMatchObject({
        response: { code: 'RANK_NOT_IN_FORMAL_GROUP_CATALOG' },
      });
    });

    // A formal rank is a declaration someone authorized in the Group has
    // to confirm - the current rank is untouched until then.
    it('creates a pending FormalRankRequest instead of an assignment for a regular member', async () => {
      const { em, persist } = buildMockEm({
        activeFormalGroup: buildFormalGroup('group-1'),
        rank: buildRank({}),
        currentAssignment: null,
        administersFormalGroup: false,
      });
      const service = new FormalRankService(
        em,
        buildMockEventAccessService(),
        buildMockFormalRankRequestsService(),
      );

      const result = await service.setCurrent(buildUser(), {
        rankId: 'rank-1',
        startedOn: '2020-05-01',
        awardedByName: 'Mestre Marcão',
        eventId: null,
      });

      expect('pendingRequest' in result).toBe(true);
      const persisted = (persist.mock.calls as [unknown][]).map(
        ([entity]) => entity,
      );
      expect(
        persisted.some((entity) => entity instanceof FormalRankAssignment),
      ).toBe(false);
      const request = persisted.find(
        (entity): entity is FormalRankRequest =>
          entity instanceof FormalRankRequest,
      );
      expect(request?.status).toBe(FormalRankRequestStatus.PENDING);
      expect(request?.rank.id).toBe('rank-1');
      expect(request?.awardedByName).toBe('Mestre Marcão');
    });

    it("confirms immediately for the formal Group's own OWNER/ADMIN", async () => {
      const { em, persist } = buildMockEm({
        activeFormalGroup: buildFormalGroup('group-1'),
        rank: buildRank({}),
        currentAssignment: null,
        administersFormalGroup: true,
      });
      const service = new FormalRankService(
        em,
        buildMockEventAccessService(),
        buildMockFormalRankRequestsService(),
      );

      const result = await service.setCurrent(buildUser(), {
        rankId: 'rank-1',
        awardedByName: 'Mestre Marcão',
        eventId: null,
      });

      expect(
        (persist.mock.calls as [unknown][]).some(
          ([entity]) => entity instanceof FormalRankAssignment,
        ),
      ).toBe(true);
      if ('pendingRequest' in result) {
        throw new Error('expected an immediate assignment');
      }
      expect(result.awardedByName).toBe('Mestre Marcão');
      expect(result.isCurrent).toBe(true);
      expect(result.sourceGroup.id).toBe('group-1');
    });
  });

  describe('endCurrent', () => {
    it('throws RANK_NOT_SET when there is no active assignment', async () => {
      const { em } = buildMockEm({ currentAssignment: null });
      const service = new FormalRankService(
        em,
        buildMockEventAccessService(),
        buildMockFormalRankRequestsService(),
      );

      const promise = service.endCurrent(buildUser());

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'RANK_NOT_SET' },
      });
    });
  });

  describe('getCurrent', () => {
    it('throws RANK_NOT_SET when there is no active assignment', async () => {
      const { em } = buildMockEm({ currentAssignment: null });
      const service = new FormalRankService(
        em,
        buildMockEventAccessService(),
        buildMockFormalRankRequestsService(),
      );

      const promise = service.getCurrent('user-1');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'RANK_NOT_SET' },
      });
    });
  });
});
