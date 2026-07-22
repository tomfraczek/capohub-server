/**
 * Unit tests for DiscoveryService.
 *
 * Covers:
 *  - resolveByCode(): Root Group (Organization) → resourceType = 'ORGANIZATION',
 *    isOrganization = true; Child Group → resourceType = 'GROUP';
 *    User → resourceType = 'USER'; unknown code → NotFoundException
 *  - searchVisibleGroups(): isHidden=false groups returned;
 *    isHidden=true groups are excluded by the query filter (tested via mock)
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
  group.parentGroup = null; // Root Group = Organization
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
  group.parentGroup = buildRootGroup() as never;
  return Object.assign(group, overrides);
}

// ─── Mock EM factory ─────────────────────────────────────────────────────────

interface MockRouting {
  findOneResult?: Group | User | null;
  findResults?: Group[];
}

function buildMockEm(routing: MockRouting = {}) {
  const findOne = jest.fn().mockResolvedValue(routing.findOneResult ?? null);
  const find = jest.fn().mockResolvedValue(routing.findResults ?? []);

  const em = { findOne, find } as unknown as EntityManager;
  return { em, findOne, find };
}

function buildService(em: EntityManager) {
  return new DiscoveryService(em);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DiscoveryService', () => {
  const requestingUser = buildUser();

  // ─── resolveByCode() ───────────────────────────────────────────────────

  describe('resolveByCode()', () => {
    it('returns resourceType ORGANIZATION and isOrganization=true for a Root Group', async () => {
      const rootGroup = buildRootGroup();
      const { em, findOne } = buildMockEm();
      findOne
        .mockResolvedValueOnce(rootGroup) // Group lookup
        .mockResolvedValue(null); // membership + pending request checks
      const service = buildService(em);

      const result = await service.resolveByCode('CBRA-0001', requestingUser);

      expect(result.resourceType).toBe('ORGANIZATION');
      expect(result.group).not.toBeNull();
      expect(result.group!.isOrganization).toBe(true);
      expect(result.user).toBeNull();
    });

    it('returns resourceType GROUP and isOrganization=false for a Child Group', async () => {
      const childGroup = buildChildGroup();
      const { em, findOne } = buildMockEm();
      findOne.mockResolvedValueOnce(childGroup).mockResolvedValue(null);
      const service = buildService(em);

      const result = await service.resolveByCode('CBPL-0001', requestingUser);

      expect(result.resourceType).toBe('GROUP');
      expect(result.group!.isOrganization).toBe(false);
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
      expect(result.resourceType).toBe('ORGANIZATION');
      expect(result.group!.isHidden).toBe(true);
    });
  });

  // ─── searchVisibleGroups() ─────────────────────────────────────────────

  describe('searchVisibleGroups()', () => {
    it('queries only isHidden=false + ACTIVE groups', async () => {
      const { em, find } = buildMockEm({ findResults: [] });
      const service = buildService(em);

      await service.searchVisibleGroups(undefined, requestingUser);

      expect(find).toHaveBeenCalledWith(
        Group,
        expect.objectContaining({
          isHidden: false,
          status: GroupStatus.ACTIVE,
        }),
        expect.anything(),
      );
    });

    it('passes the name filter when a query string is provided', async () => {
      const { em, find } = buildMockEm({ findResults: [] });
      const service = buildService(em);

      await service.searchVisibleGroups('brasil', requestingUser);

      const whereArg = find.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg).toMatchObject({ name: { $ilike: '%brasil%' } });
    });

    it('does not pass a name filter when query is empty', async () => {
      const { em, find } = buildMockEm({ findResults: [] });
      const service = buildService(em);

      await service.searchVisibleGroups('', requestingUser);

      const whereArg = find.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg).not.toHaveProperty('name');
    });

    it('returns each result with correct resourceType based on parentGroup', async () => {
      const rootGroup = buildRootGroup();
      const childGroup = buildChildGroup();
      const { em, findOne } = buildMockEm({
        findResults: [rootGroup, childGroup],
      });
      // membership + pending request checks return null (not a member)
      findOne.mockResolvedValue(null);
      const service = buildService(em);

      const results = await service.searchVisibleGroups(
        undefined,
        requestingUser,
      );

      expect(results[0].resourceType).toBe('ORGANIZATION');
      expect(results[0].group!.isOrganization).toBe(true);
      expect(results[1].resourceType).toBe('GROUP');
      expect(results[1].group!.isOrganization).toBe(false);
    });

    it('hidden groups (isHidden=true) are excluded because the query filter prevents them from being returned', async () => {
      // The service passes { isHidden: false } to em.find() - this test verifies
      // that the filter is present.  The actual DB filtering is an integration
      // concern; here we confirm the filter is constructed correctly.
      const { em, find } = buildMockEm({ findResults: [] });
      const service = buildService(em);

      await service.searchVisibleGroups(undefined, requestingUser);

      const whereArg = find.mock.calls[0][1] as Record<string, unknown>;
      expect(whereArg.isHidden).toBe(false);
    });
  });
});
