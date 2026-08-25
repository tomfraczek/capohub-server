/**
 * Unit tests for DiscoveryService.
 *
 * Covers (post organizational-domain rebuild, stage 1 - Group and Section
 * are now separate tables, so search() queries and merges both):
 *  - resolveByCode(): Group → resourceType = 'GROUP', isRootGroup = true;
 *    Section → resourceType = 'SECTION'; User → resourceType = 'USER';
 *    unknown code → NotFoundException
 *  - search(): always filters isHidden=false + status=ACTIVE on both
 *    tables; name filter applies to both; country/city filters only ever
 *    match a Section (Group has no location fields); type=GROUP/SECTION
 *    narrows which table(s) are queried at all; each result maps to the
 *    correct CommunitySearchResultDto shape (type/parentId/sectionsCount)
 */

import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { PublicUrlBuilder } from '../storage/image-url.util';
import { User } from '../users/entities/user.entity';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { DiscoveryService } from './discovery.service';
import { DiscoverySearchQuery } from './dto/discovery-search-query.schema';

function buildUrlBuilder(): PublicUrlBuilder {
  return { buildPublicUrl: (key) => `https://cdn.example.com/${key}` };
}

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

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'root-1';
  group.name = 'Capoeira Brasil';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  group.isPublic = true;
  group.isHidden = false;
  group.publicCode = 'CBRA-0001';
  group.description = null;
  group.logoUrl = null;
  group.coverImageUrl = null;
  group.websiteUrl = null;
  return Object.assign(group, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Capoeira Brasil Poland';
  section.status = GroupStatus.ACTIVE;
  section.parentGroup = buildGroup();
  section.isPublic = true;
  section.isHidden = false;
  section.publicCode = 'CBPL-0001';
  section.description = null;
  section.logoUrl = null;
  section.coverImageUrl = null;
  section.websiteUrl = null;
  section.country = null;
  section.city = null;
  return Object.assign(section, overrides);
}

// ─── Mock EM factory ─────────────────────────────────────────────────────────

interface MockRouting {
  groupFindOneResult?: Group | null;
  sectionFindOneResult?: Section | null;
  userFindOneResult?: User | null;
  groupFindResult?: Group[];
  sectionFindResult?: Section[];
  sectionCountRows?: { parent_group_id: string; count: string }[];
}

function buildMockEm(routing: MockRouting = {}) {
  const findOne = jest.fn<Promise<unknown>, unknown[]>((entity: unknown) => {
    if (entity === Group)
      return Promise.resolve(routing.groupFindOneResult ?? null);
    if (entity === Section)
      return Promise.resolve(routing.sectionFindOneResult ?? null);
    if (entity === User)
      return Promise.resolve(routing.userFindOneResult ?? null);
    return Promise.resolve(null);
  });
  const find = jest.fn<Promise<unknown[]>, unknown[]>((entity: unknown) => {
    if (entity === Group) return Promise.resolve(routing.groupFindResult ?? []);
    if (entity === Section)
      return Promise.resolve(routing.sectionFindResult ?? []);
    return Promise.resolve([]);
  });
  const execute = jest
    .fn<Promise<{ parent_group_id: string; count: string }[]>, unknown[]>()
    .mockResolvedValue(routing.sectionCountRows ?? []);
  const getConnection = jest.fn().mockReturnValue({ execute });

  const em = { findOne, find, getConnection } as unknown as EntityManager;
  return { em, findOne, find, execute };
}

function buildGroupHierarchyService(em: EntityManager): GroupHierarchyService {
  return {
    findCommunityById: jest.fn(async (id: string) => {
      const group = await em.findOne(Group, { id });
      if (group) return group;
      return em.findOne(Section, { id });
    }),
    resolveRootGroup: jest.fn(() => Promise.reject(new Error('no membership'))),
  } as unknown as GroupHierarchyService;
}

function buildService(em: EntityManager) {
  const roleAssignmentsService = {
    isCommunityMember: jest.fn().mockResolvedValue(false),
  } as unknown as RoleAssignmentsService;
  return new DiscoveryService(
    em,
    buildGroupHierarchyService(em),
    roleAssignmentsService,
    buildUrlBuilder() as never,
  );
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
    it('returns resourceType GROUP and isRootGroup=true for a Group', async () => {
      const group = buildGroup();
      const { em } = buildMockEm({ groupFindOneResult: group });
      const service = buildService(em);

      const result = await service.resolveByCode('CBRA-0001', requestingUser);

      expect(result.resourceType).toBe('GROUP');
      expect(result.group).not.toBeNull();
      expect(result.group!.isRootGroup).toBe(true);
      expect(result.user).toBeNull();
    });

    it('returns resourceType SECTION and isRootGroup=false for a Section', async () => {
      const section = buildSection();
      const { em } = buildMockEm({ sectionFindOneResult: section });
      const service = buildService(em);

      const result = await service.resolveByCode('CBPL-0001', requestingUser);

      expect(result.resourceType).toBe('SECTION');
      expect(result.group!.isRootGroup).toBe(false);
    });

    it('returns resourceType USER when the code belongs to a User (no matching Group/Section)', async () => {
      const user = buildUser({ publicCode: 'USR-0001' });
      const { em } = buildMockEm({ userFindOneResult: user });
      const service = buildService(em);

      const result = await service.resolveByCode('USR-0001', requestingUser);

      expect(result.resourceType).toBe('USER');
      expect(result.user).not.toBeNull();
      expect(result.user!.id).toBe('user-1');
      expect(result.group).toBeNull();
    });

    it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl for a Group', async () => {
      const group = buildGroup({
        logoUrl: 'https://legacy.example.com/old-logo.png',
        profileImageKey: 'groups/root-1/profile/uuid.webp',
      });
      const { em } = buildMockEm({ groupFindOneResult: group });
      const service = buildService(em);

      const result = await service.resolveByCode('CBRA-0001', requestingUser);

      expect(result.group!.logoUrl).toBe(
        'https://cdn.example.com/groups/root-1/profile/uuid.webp',
      );
    });

    it('prefers the R2 public URL derived from avatarImageKey over the legacy avatarUrl for a User', async () => {
      const user = buildUser({
        publicCode: 'USR-0001',
        avatarType: 'UPLOAD' as never,
        avatarUrl: null,
        avatarImageKey: 'users/user-1/profile/uuid.webp',
      });
      const { em } = buildMockEm({ userFindOneResult: user });
      const service = buildService(em);

      const result = await service.resolveByCode('USR-0001', requestingUser);

      expect(result.user!.avatarUrl).toBe(
        'https://cdn.example.com/users/user-1/profile/uuid.webp',
      );
    });

    it('normalizes the code to uppercase before lookup', async () => {
      const group = buildGroup();
      const { em, findOne } = buildMockEm({ groupFindOneResult: group });
      const service = buildService(em);

      await service.resolveByCode('cbra-0001', requestingUser);

      expect(findOne).toHaveBeenCalledWith(
        Group,
        expect.objectContaining({ publicCode: 'CBRA-0001' }),
      );
    });

    it('throws NotFoundException for an unknown code', async () => {
      const { em } = buildMockEm();
      const service = buildService(em);

      await expect(
        service.resolveByCode('XXXX-XXXX', requestingUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the Group even when isHidden=true (publicCode bypasses hidden filter)', async () => {
      const hiddenGroup = buildGroup({ isHidden: true });
      const { em } = buildMockEm({ groupFindOneResult: hiddenGroup });
      const service = buildService(em);

      const result = await service.resolveByCode('CBRA-0001', requestingUser);

      expect(result.resourceType).toBe('GROUP');
      expect(result.group!.isHidden).toBe(true);
    });
  });

  // ─── search() ────────────────────────────────────────────────────────

  describe('search()', () => {
    it('always queries isHidden=false + ACTIVE on both tables', async () => {
      const { em, find } = buildMockEm();
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil' }));

      expect(find).toHaveBeenCalledWith(
        Group,
        expect.objectContaining({
          isHidden: false,
          status: GroupStatus.ACTIVE,
        }),
        expect.anything(),
      );
      expect(find).toHaveBeenCalledWith(
        Section,
        expect.objectContaining({
          isHidden: false,
          status: GroupStatus.ACTIVE,
        }),
        expect.anything(),
      );
    });

    it('passes the name filter as a case-insensitive substring match on both tables', async () => {
      const { em, find } = buildMockEm();
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil' }));

      const groupWhere = find.mock.calls.find(
        (c) => c[0] === Group,
      )![1] as Record<string, unknown>;
      const sectionWhere = find.mock.calls.find(
        (c) => c[0] === Section,
      )![1] as Record<string, unknown>;
      expect(groupWhere).toMatchObject({ name: { $ilike: '%brasil%' } });
      expect(sectionWhere).toMatchObject({ name: { $ilike: '%brasil%' } });
    });

    it('a country/city filter only ever queries Sections - a Group has no location fields', async () => {
      const { em, find } = buildMockEm();
      const service = buildService(em);

      await service.search(buildQuery({ country: 'PL', city: 'Poznan' }));

      expect(find).not.toHaveBeenCalledWith(
        Group,
        expect.anything(),
        expect.anything(),
      );
      const sectionWhere = find.mock.calls.find(
        (c) => c[0] === Section,
      )![1] as Record<string, unknown>;
      expect(sectionWhere).toMatchObject({
        country: 'PL',
        city: { $ilike: '%Poznan%' },
      });
    });

    it('queries only Group when type=GROUP', async () => {
      const { em, find } = buildMockEm();
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil', type: 'GROUP' }));

      expect(find).toHaveBeenCalledWith(
        Group,
        expect.anything(),
        expect.anything(),
      );
      expect(find).not.toHaveBeenCalledWith(
        Section,
        expect.anything(),
        expect.anything(),
      );
    });

    it('queries only Section when type=SECTION', async () => {
      const { em, find } = buildMockEm();
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil', type: 'SECTION' }));

      expect(find).not.toHaveBeenCalledWith(
        Group,
        expect.anything(),
        expect.anything(),
      );
      expect(find).toHaveBeenCalledWith(
        Section,
        expect.anything(),
        expect.anything(),
      );
    });

    it('returns each result with the correct type and parentId/sectionsCount', async () => {
      const group = buildGroup();
      const section = buildSection();
      const { em } = buildMockEm({
        groupFindResult: [group],
        sectionFindResult: [section],
        sectionCountRows: [{ parent_group_id: 'root-1', count: '3' }],
      });
      const service = buildService(em);

      const result = await service.search(buildQuery({ name: 'brasil' }));

      const groupResult = result.data.find((r) => r.id === 'root-1');
      const sectionResult = result.data.find((r) => r.id === 'section-1');
      expect(groupResult).toMatchObject({
        type: 'GROUP',
        parentId: null,
        sectionsCount: 3,
      });
      expect(sectionResult).toMatchObject({
        type: 'SECTION',
        parentId: 'root-1',
        sectionsCount: null,
      });
    });

    it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl for a Group result', async () => {
      const group = buildGroup({
        logoUrl: 'https://legacy.example.com/old-logo.png',
        profileImageKey: 'groups/root-1/profile/uuid.webp',
      });
      const { em } = buildMockEm({ groupFindResult: [group] });
      const service = buildService(em);

      const result = await service.search(buildQuery({ name: 'brasil' }));

      expect(result.data.find((r) => r.id === 'root-1')?.logoUrl).toBe(
        'https://cdn.example.com/groups/root-1/profile/uuid.webp',
      );
    });

    it('falls back to the legacy logoUrl for a Group result when profileImageKey is unset', async () => {
      const group = buildGroup({
        logoUrl: 'https://legacy.example.com/old-logo.png',
      });
      const { em } = buildMockEm({ groupFindResult: [group] });
      const service = buildService(em);

      const result = await service.search(buildQuery({ name: 'brasil' }));

      expect(result.data.find((r) => r.id === 'root-1')?.logoUrl).toBe(
        'https://legacy.example.com/old-logo.png',
      );
    });

    it('returns null logoUrl for a Group result when neither profileImageKey nor legacy logoUrl is set', async () => {
      const group = buildGroup();
      const { em } = buildMockEm({ groupFindResult: [group] });
      const service = buildService(em);

      const result = await service.search(buildQuery({ name: 'brasil' }));

      expect(result.data.find((r) => r.id === 'root-1')?.logoUrl).toBeNull();
    });

    it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl for a Section result', async () => {
      const section = buildSection({
        logoUrl: 'https://legacy.example.com/old-section-logo.png',
        profileImageKey: 'sections/section-1/profile/uuid.webp',
      });
      const { em } = buildMockEm({ sectionFindResult: [section] });
      const service = buildService(em);

      const result = await service.search(buildQuery({ name: 'brasil' }));

      expect(result.data.find((r) => r.id === 'section-1')?.logoUrl).toBe(
        'https://cdn.example.com/sections/section-1/profile/uuid.webp',
      );
    });

    it('hidden Groups/Sections are excluded because the query filter prevents them from being returned', async () => {
      const { em, find } = buildMockEm();
      const service = buildService(em);

      await service.search(buildQuery({ name: 'brasil' }));

      const groupWhere = find.mock.calls.find(
        (c) => c[0] === Group,
      )![1] as Record<string, unknown>;
      expect(groupWhere.isHidden).toBe(false);
    });

    it('returns pagination meta reflecting the requested page/limit and total count', async () => {
      const { em } = buildMockEm({ groupFindResult: [buildGroup()] });
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
