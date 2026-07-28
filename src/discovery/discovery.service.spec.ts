/**
 * Unit tests for DiscoveryService.
 *
 * Covers:
 *  - resolveByCode(): Root Group → resourceType = 'GROUP',
 *    isRootGroup = true; Section (non-root Group) → resourceType = 'SECTION';
 *    User → resourceType = 'USER'; unknown code → NotFoundException
 *  - search(): always filters isHidden=false + status=ACTIVE; name/country/
 *    city filters are added only when provided; type=GROUP/SECTION narrows
 *    via parentGroup; each result maps to the correct
 *    CommunitySearchResultDto shape (type/parentId/sectionsCount)
 */

import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Group } from '../groups/entities/group.entity';
import { GroupMembership } from '../groups/entities/group-membership.entity';
import { MembershipRequest } from '../groups/entities/membership-request.entity';
import { User } from '../users/entities/user.entity';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { GroupMembershipStatus } from '../groups/enums/group-membership-status.enum';
import { DiscoveryService } from './discovery.service';
import { DiscoverySearchQuery } from './dto/discovery-search-query.schema';

// ─── Builders ────────────────────────────────────────────────────────────────

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'test@example.com';
  user.displayName = 'Test User';
  user.publicCode = 'TEST-0001';
  user.avatarUrl = null;
  return Object.assign(user, overrides);
}

function buildRootGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'root-1';
  group.name = 'Capoeira Brasil';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null; // Root Group = Group
  group.isPublic = true;
  group.isHidden = false;
  group.publicCode = 'CBRA-0001';
  group.description = null;
  group.logoUrl = null;
  group.coverImageUrl = null;
  group.websiteUrl = null;
  return Object.assign(group, overrides);
}

function buildChildGroup(overrides: Partial<Group> = {}): Group {
  const group = buildRootGroup({
    id: 'child-1',
    name: 'Capoeira Brasil Poland',
    publicCode: 'CBPL-0001',
  });
  // Non-null parentGroup proxy marks this as a Child Group
  group.parentGroup = buildRootGroup();
  return Object.assign(group, overrides);
}

// ─── Mock EM factory ─────────────────────────────────────────────────────────

interface MockRouting {
  findOneResult?: Group | User | null;
  findAndCountResult?: [Group[], number];
  // Rows countDirectSections() reads back from the raw connection query -
  // see discovery.service.ts.
  sectionCountRows?: { parent_group_id: string; count: string }[];
}

function buildMockEm(routing: MockRouting = {}) {
  const findOne = jest.fn().mockResolvedValue(routing.findOneResult ?? null);
  const findAndCount = jest
    .fn()
    .mockResolvedValue(routing.findAndCountResult ?? [[], 0]);
  const execute = jest.fn().mockResolvedValue(routing.sectionCountRows ?? []);
  const getConnection = jest.fn().mockReturnValue({ execute });

  const em = {
    findOne,
    findAndCount,
    getConnection,
  } as unknown as EntityManager;
  return { em, findOne, findAndCount, execute };
}

function buildService(em: EntityManager) {
  return new DiscoveryService(em);
}

function buildQuery(
  overrides: Partial<DiscoverySearchQuery> = {},
): DiscoverySearchQuery {
  return {
    page: 1,
    limit: 20,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DiscoveryService', () => {
  const requestingUser = buildUser();

  // ─── resolveByCode() ───────────────────────────────────────────────────

  describe('resolveByCode()', () => {
    it('returns resourceType GROUP and isRootGroup=true for a Root Group', async () => {
      const rootGroup = buildRootGroup();
      const { em, findOne } = buildMockEm();
      findOne
        .mockResolvedValueOnce(rootGroup) // Group lookup
        .mockResolvedValue(null); // membership + pending request checks
      const service = buildService(em);

      const result = await service.resolveByCode('CBRA-0001', requestingUser);

      expect(result.resourceType).toBe('GROUP');
      expect(result.group).not.toBeNull();
      expect(result.group!.isRootGroup).toBe(true);
      expect(result.user).toBeNull();
    });

    it('returns resourceType SECTION and isRootGroup=false for a Section', async () => {
      const childGroup = buildChildGroup();
      const { em, findOne } = buildMockEm();
      findOne.mockResolvedValueOnce(childGroup).mockResolvedValue(null);
      const service = buildService(em);

      const result = await service.resolveByCode('CBPL-0001', requestingUser);

      expect(result.resourceType).toBe('SECTION');
      expect(result.group!.isRootGroup).toBe(false);
    });

    it('returns resourceType USER when the code belongs to a User (no matching Group)', async () => {
      const user = buildUser({ publicCode: 'USR-0001' });
      const { em, findOne } = buildMockEm();
      findOne
        .mockResolvedValueOnce(null) // Group lookup → miss
        .mockResolvedValueOnce(user); // User lookup → hit
      const service = buildService(em);

      const result = await service.resolveByCode('USR-0001', requestingUser);

      expect(result.resourceType).toBe('USER');
      expect(result.user).not.toBeNull();
      expect(result.user!.id).toBe('user-1');
      expect(result.group).toBeNull();
    });

    it('normalizes the code to uppercase before lookup', async () => {
      const rootGroup = buildRootGroup();
      const { em, findOne } = buildMockEm();
      findOne.mockResolvedValueOnce(rootGroup).mockResolvedValue(null);
      const service = buildService(em);

      await service.resolveByCode('cbra-0001', requestingUser);

      // The first findOne call should use the uppercased code
      expect(findOne.mock.calls[0][1]).toMatchObject({
        publicCode: 'CBRA-0001',
      });
    });

    it('throws NotFoundException for an unknown code', async () => {
      const { em } = buildMockEm({ findOneResult: null });
      const service = buildService(em);

      await expect(
        service.resolveByCode('XXXX-XXXX', requestingUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the Group even when isHidden=true (publicCode bypasses hidden filter)', async () => {
      const hiddenGroup = buildRootGroup({ isHidden: true });
      const { em, findOne } = buildMockEm();
      findOne.mockResolvedValueOnce(hiddenGroup).mockResolvedValue(null);
      const service = buildService(em);

      const result = await service.resolveByCode('CBRA-0001', requestingUser);

      // The result is returned regardless of isHidden
      expect(result.resourceType).toBe('GROUP');
      expect(result.group!.isHidden).toBe(true);
    });
  });

  // ─── search() ────────────────────────────────────────────────────────

  describe('search()', () => {
    it('always queries isHidden=false + ACTIVE, regardless of which filters are provided', async () => {
      const { em, findAndCount } = buildMockEm({
        findAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil' }));

      expect(findAndCount).toHaveBeenCalledWith(
        Group,
        expect.objectContaining({
          isHidden: false,
          status: GroupStatus.ACTIVE,
        }),
        expect.anything(),
      );
    });

    it('passes the name filter as a case-insensitive substring match when provided', async () => {
      const { em, findAndCount } = buildMockEm({
        findAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil' }));

      const whereArg = findAndCount.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg).toMatchObject({ name: { $ilike: '%brasil%' } });
    });

    it('does not pass a name filter when none is given', async () => {
      const { em, findAndCount } = buildMockEm({
        findAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.search(buildQuery({ country: 'PL' }));

      const whereArg = findAndCount.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg).not.toHaveProperty('name');
    });

    it('passes the country filter as an exact match and the city filter as a substring match', async () => {
      const { em, findAndCount } = buildMockEm({
        findAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.search(buildQuery({ country: 'PL', city: 'Poznan' }));

      const whereArg = findAndCount.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg).toMatchObject({
        country: 'PL',
        city: { $ilike: '%Poznan%' },
      });
    });

    it('narrows to root Groups only when type=GROUP', async () => {
      const { em, findAndCount } = buildMockEm({
        findAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil', type: 'GROUP' }));

      const whereArg = findAndCount.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg).toMatchObject({ parentGroup: null });
    });

    it('narrows to Sections only when type=SECTION', async () => {
      const { em, findAndCount } = buildMockEm({
        findAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil', type: 'SECTION' }));

      const whereArg = findAndCount.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg).toMatchObject({ parentGroup: { $ne: null } });
    });

    it('returns each result with the correct type and parentId/sectionsCount based on parentGroup', async () => {
      const rootGroup = buildRootGroup();
      const childGroup = buildChildGroup();
      const { em } = buildMockEm({
        findAndCountResult: [[rootGroup, childGroup], 2],
        sectionCountRows: [{ parent_group_id: 'root-1', count: '3' }],
      });
      const service = buildService(em);

      const result = await service.search(buildQuery({ name: 'brasil' }));

      expect(result.data[0]).toMatchObject({
        id: 'root-1',
        type: 'GROUP',
        parentId: null,
        sectionsCount: 3,
      });
      expect(result.data[1]).toMatchObject({
        id: 'child-1',
        type: 'SECTION',
        parentId: 'root-1',
        sectionsCount: null,
      });
    });

    it('hidden Groups/Sections are excluded because the query filter prevents them from being returned', async () => {
      // The service passes { isHidden: false } to em.findAndCount() - this
      // test verifies that the filter is present. The actual DB filtering
      // is an integration concern; here we confirm the filter is
      // constructed correctly.
      const { em, findAndCount } = buildMockEm({
        findAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil' }));

      const whereArg = findAndCount.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg.isHidden).toBe(false);
    });

    it('returns pagination meta reflecting the requested page/limit and total count', async () => {
      const { em } = buildMockEm({
        findAndCountResult: [[buildRootGroup()], 1],
      });
      const service = buildService(em);

      const result = await service.search(
        buildQuery({ name: 'brasil', page: 1, limit: 20 }),
      );

      expect(result.meta).toMatchObject({
        page: 1,
        limit: 20,
        totalItems: 1,
      });
    });
  });
});
