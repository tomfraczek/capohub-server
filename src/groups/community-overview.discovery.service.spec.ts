/**
 * Unit tests for CommunityOverviewService's COUNTRY discovery-fallback tier
 * (getCountryDiscoverySections/getCountryDiscoveryGroups) - see
 * CommunityDiscoveryContextDto's own comment. Covers:
 *  1. ranks by active member count desc, then createdAt asc as a
 *     deterministic secondary sort
 *  2. excludes the caller's own Sections
 *  3. no discovery location configured -> both empty (no error)
 *  4. discoveryGroups excludes every Group already in myGroups and
 *     aggregates by the qualifying Section with the highest member count
 *  5. ranking is stable/deterministic across repeated calls with identical
 *     input (no reliance on unordered Map/Set iteration)
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { GroupStatus } from './enums/group-status.enum';
import { GroupFollowService } from './group-follow.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { CommunityLocationContext } from './dto/community-location-context.schema';
import { CommunityOverviewService } from './community-overview.service';

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Cordão de Ouro';
  group.status = GroupStatus.ACTIVE;
  group.isPublic = true;
  group.isHidden = false;
  return Object.assign(group, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Poznan';
  section.status = GroupStatus.ACTIVE;
  section.isPublic = true;
  section.isHidden = false;
  section.country = 'PL';
  section.latitude = 52.0;
  section.longitude = 17.0;
  section.createdAt = new Date('2026-01-01T00:00:00.000Z');
  return Object.assign(section, overrides);
}

function buildMembershipRow(sectionId: string): SectionMembership {
  const membership = new SectionMembership();
  membership.section = { id: sectionId } as never;
  return membership;
}

function buildLocation(
  overrides: Partial<CommunityLocationContext> = {},
): CommunityLocationContext {
  return {
    city: 'Poznań',
    countryCode: 'PL',
    region: null,
    latitude: 52.4064,
    longitude: 16.9252,
    ...overrides,
  };
}

interface Routing {
  location?: CommunityLocationContext | null;
  myMemberships?: SectionMembership[];
  countryCandidates?: Section[];
  memberCountRows?: SectionMembership[];
  followedGroupIds?: string[];
}

function buildEm(routing: Routing) {
  const find = jest.fn((entity: unknown, filter: Record<string, unknown>) => {
    if (entity === Section) {
      // The country-fallback candidate scan (findCountrySectionCandidates)
      // filters by `country`; the "resolve my own Sections' parentGroup"
      // query (resolveMyGroupRelations) filters by `id`. Never confused
      // with the nearby bounding-box query (filters by `latitude`
      // range/`longitude` range with no `country` key) - this suite never
      // exercises that path.
      if ('country' in filter) {
        return Promise.resolve(routing.countryCandidates ?? []);
      }
      return Promise.resolve([]);
    }
    if (entity === SectionMembership) {
      // listMySectionIds filters by `user`; countActiveMembers filters by
      // `section: {$in: [...]}` with no `user` key.
      if ('user' in filter) {
        return Promise.resolve(routing.myMemberships ?? []);
      }
      return Promise.resolve(routing.memberCountRows ?? []);
    }
    throw new Error(`Unexpected find entity: ${String(entity)}`);
  });

  return { find } as unknown as EntityManager;
}

function buildService(routing: Routing) {
  const em = buildEm(routing);
  const groupFollowService = {
    listFollowedGroupIds: jest
      .fn()
      .mockResolvedValue(routing.followedGroupIds ?? []),
  } as unknown as GroupFollowService;
  const r2StorageService = {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;

  return new CommunityOverviewService(em, groupFollowService, r2StorageService);
}

const PAGE = { limit: 20, offset: 0 };

describe('CommunityOverviewService - country discovery fallback', () => {
  it('1. ranks by active member count desc, then createdAt asc as a deterministic secondary sort', async () => {
    const oldFewMembers = buildSection({
      id: 'section-old-few',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const newManyMembers = buildSection({
      id: 'section-new-many',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const newFewMembers = buildSection({
      id: 'section-new-few',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const location = buildLocation();
    const service = buildService({
      location,
      countryCandidates: [oldFewMembers, newManyMembers, newFewMembers],
      memberCountRows: [
        buildMembershipRow('section-old-few'),
        buildMembershipRow('section-new-many'),
        buildMembershipRow('section-new-many'),
        buildMembershipRow('section-new-many'),
        // section-new-few gets zero rows -> zero members.
      ],
    });

    const result = await service.getCountryDiscoverySections(
      'user-1',
      location,
      PAGE,
    );

    expect(result.items.map((s) => s.id)).toEqual([
      'section-new-many', // 3 members
      'section-old-few', // 1 member
      'section-new-few', // 0 members
    ]);
  });

  it('2. excludes the caller own Sections', async () => {
    const mine = buildSection({ id: 'section-mine' });
    const other = buildSection({ id: 'section-other' });
    const location = buildLocation();
    const service = buildService({
      location,
      myMemberships: [buildMembershipRow('section-mine')],
      countryCandidates: [mine, other],
      memberCountRows: [],
    });

    const result = await service.getCountryDiscoverySections(
      'user-1',
      location,
      PAGE,
    );

    expect(result.items.map((s) => s.id)).toEqual(['section-other']);
  });

  it('3. no discovery location configured: both discoverySections and discoveryGroups are empty, never an error', async () => {
    const service = buildService({ location: null });

    const sections = await service.getCountryDiscoverySections(
      'user-1',
      null,
      PAGE,
    );
    const groups = await service.getCountryDiscoveryGroups(
      'user-1',
      null,
      PAGE,
    );

    expect(sections).toEqual({ items: [], total: 0, hasMore: false });
    expect(groups).toEqual({ items: [], total: 0, hasMore: false });
  });

  it('4. discoveryGroups excludes every Group already in myGroups and aggregates by the highest-memberCount Section', async () => {
    const myGroup = buildGroup({ id: 'group-mine' });
    const mySection = buildSection({
      id: 'section-mine',
      parentGroup: myGroup,
    });
    const otherGroup = buildGroup({ id: 'group-other' });
    const weakSection = buildSection({
      id: 'section-other-weak',
      parentGroup: otherGroup,
    });
    const strongSection = buildSection({
      id: 'section-other-strong',
      parentGroup: otherGroup,
    });
    const location = buildLocation();
    const service = buildService({
      location,
      myMemberships: [buildMembershipRow('section-mine')],
      countryCandidates: [mySection, weakSection, strongSection],
      memberCountRows: [
        buildMembershipRow('section-other-weak'),
        buildMembershipRow('section-other-strong'),
        buildMembershipRow('section-other-strong'),
      ],
      followedGroupIds: [],
    });

    const result = await service.getCountryDiscoveryGroups(
      'user-1',
      location,
      PAGE,
    );

    expect(result.items.map((g) => g.id)).toEqual(['group-other']);
    expect(result.items[0].nearestSection.id).toBe('section-other-strong');
    expect(result.items[0].sectionsCountInRadius).toBe(2);
  });

  it('5. ranking is stable across repeated calls with identical input', async () => {
    const a = buildSection({ id: 'section-a' });
    const b = buildSection({ id: 'section-b' });
    const location = buildLocation();
    const service = buildService({
      location,
      countryCandidates: [a, b],
      memberCountRows: [],
    });

    const first = await service.getCountryDiscoverySections(
      'user-1',
      location,
      PAGE,
    );
    const second = await service.getCountryDiscoverySections(
      'user-1',
      location,
      PAGE,
    );

    expect(first.items.map((s) => s.id)).toEqual(second.items.map((s) => s.id));
  });
});
