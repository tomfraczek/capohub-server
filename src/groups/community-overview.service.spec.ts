/**
 * Unit tests for CommunityOverviewService - the shared implementation
 * behind GET /community/home's location/mySections/myGroups/nearbySections/
 * nearbyGroups blocks and their paginated GET /community/{sections,groups}/
 * {mine,nearby} counterparts. Covers:
 *  1. a user with no Sections and no follows -> everything empty
 *  2. a user belonging to one Section -> mySections/myGroups reflect it
 *  3. a user in several Sections of the same Group -> myGroups lists that
 *     Group exactly once
 *  4. a user in Sections of different Groups -> myGroups lists each once
 *  5. a user following several Groups -> myGroups includes every one,
 *     isFollowing true, isMemberThroughSection false
 *  6. a Group related through both Section membership AND an explicit
 *     follow -> still exactly one myGroups row, both flags true
 *  7. nearbySections excludes the caller's own Sections
 *  8. nearbyGroups excludes every Group already in myGroups
 *  9. nearbyGroups uses each Group's *nearest* qualifying Section
 * 10. no discovery location configured -> nearbySections/nearbyGroups are
 *     empty, but mySections/myGroups still work normally
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupFollowService } from './group-follow.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { UserDiscoveryLocation } from '../users/entities/user-discovery-location.entity';
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
  return Object.assign(section, overrides);
}

function buildMembership(
  sectionId: string,
  userId = 'user-1',
): SectionMembership {
  const membership = new SectionMembership();
  membership.section = { id: sectionId } as never;
  membership.user = { id: userId } as never;
  membership.status = SectionMembershipStatus.ACTIVE;
  return membership;
}

function buildLocation(
  overrides: Partial<UserDiscoveryLocation> = {},
): UserDiscoveryLocation {
  const location = new UserDiscoveryLocation();
  location.city = 'Poznań';
  location.countryCode = 'PL';
  location.region = null;
  location.latitude = 52.4064;
  location.longitude = 16.9252;
  return Object.assign(location, overrides);
}

interface Routing {
  location?: UserDiscoveryLocation | null;
  memberships?: SectionMembership[];
  // Section find({id: {$in: [...]}}) - used by resolveMyGroupRelations to
  // resolve each of the caller's own Sections' parentGroup.
  sectionsByIds?: Section[];
  // Section findAndCount({id: {$in: [...]}}) - getMySections' own page.
  mySectionsPage?: [Section[], number];
  // Section find({latitude: {...}, ...}) - the nearby bounding-box query.
  nearbyCandidates?: Section[];
  groups?: Group[];
  followedGroupIds?: string[];
}

function buildEm(routing: Routing) {
  const findOne = jest.fn((entity: unknown) => {
    if (entity === UserDiscoveryLocation) {
      return Promise.resolve(routing.location ?? null);
    }
    throw new Error(`Unexpected findOne entity: ${String(entity)}`);
  });

  const find = jest.fn((entity: unknown, filter: Record<string, unknown>) => {
    if (entity === SectionMembership) {
      return Promise.resolve(routing.memberships ?? []);
    }
    if (entity === Section) {
      if ('latitude' in filter) {
        return Promise.resolve(routing.nearbyCandidates ?? []);
      }
      return Promise.resolve(routing.sectionsByIds ?? []);
    }
    if (entity === Group) {
      return Promise.resolve(routing.groups ?? []);
    }
    throw new Error(`Unexpected find entity: ${String(entity)}`);
  });

  const findAndCount = jest.fn((entity: unknown) => {
    if (entity === Section) {
      return Promise.resolve(routing.mySectionsPage ?? [[], 0]);
    }
    throw new Error(`Unexpected findAndCount entity: ${String(entity)}`);
  });

  return { findOne, find, findAndCount } as unknown as EntityManager;
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

describe('CommunityOverviewService', () => {
  it('1. a user with no Sections and no follows: mySections and myGroups are both empty', async () => {
    const service = buildService({ memberships: [], followedGroupIds: [] });

    const mySections = await service.getMySections('user-1', PAGE);
    const myGroups = await service.getMyGroups('user-1', PAGE);

    expect(mySections).toEqual({ items: [], total: 0, hasMore: false });
    expect(myGroups).toEqual({ items: [], total: 0, hasMore: false });
  });

  it('2. a user belonging to one Section: mySections/myGroups reflect it, isMemberThroughSection true, isFollowing false', async () => {
    const group = buildGroup({ id: 'group-1' });
    const section = buildSection({ id: 'section-1', parentGroup: group });
    const service = buildService({
      memberships: [buildMembership('section-1')],
      sectionsByIds: [section],
      mySectionsPage: [[section], 1],
      groups: [group],
      followedGroupIds: [],
    });

    const mySections = await service.getMySections('user-1', PAGE);
    expect(mySections.items).toEqual([
      expect.objectContaining({ id: 'section-1' }),
    ]);

    const myGroups = await service.getMyGroups('user-1', PAGE);
    expect(myGroups.items).toEqual([
      expect.objectContaining({
        id: 'group-1',
        isMemberThroughSection: true,
        isFollowing: false,
      }),
    ]);
  });

  it('3. a user in several Sections of the same Group: myGroups lists that Group exactly once', async () => {
    const group = buildGroup({ id: 'group-1' });
    const sectionA = buildSection({ id: 'section-a', parentGroup: group });
    const sectionB = buildSection({ id: 'section-b', parentGroup: group });
    const service = buildService({
      memberships: [buildMembership('section-a'), buildMembership('section-b')],
      sectionsByIds: [sectionA, sectionB],
      groups: [group],
      followedGroupIds: [],
    });

    const myGroups = await service.getMyGroups('user-1', PAGE);

    expect(myGroups.total).toBe(1);
    expect(myGroups.items[0].id).toBe('group-1');
  });

  it('4. a user in Sections of different Groups: myGroups lists each Group once', async () => {
    const groupA = buildGroup({ id: 'group-a' });
    const groupB = buildGroup({ id: 'group-b' });
    const sectionA = buildSection({ id: 'section-a', parentGroup: groupA });
    const sectionB = buildSection({ id: 'section-b', parentGroup: groupB });
    const service = buildService({
      memberships: [buildMembership('section-a'), buildMembership('section-b')],
      sectionsByIds: [sectionA, sectionB],
      groups: [groupA, groupB],
      followedGroupIds: [],
    });

    const myGroups = await service.getMyGroups('user-1', PAGE);

    expect(myGroups.total).toBe(2);
    expect(myGroups.items.map((g) => g.id).sort()).toEqual([
      'group-a',
      'group-b',
    ]);
  });

  it('5. a user following several Groups (no Section membership): every one appears, isFollowing true, isMemberThroughSection false', async () => {
    const groupA = buildGroup({ id: 'group-a' });
    const groupB = buildGroup({ id: 'group-b' });
    const service = buildService({
      memberships: [],
      groups: [groupA, groupB],
      followedGroupIds: ['group-a', 'group-b'],
    });

    const myGroups = await service.getMyGroups('user-1', PAGE);

    expect(myGroups.total).toBe(2);
    for (const item of myGroups.items) {
      expect(item.isFollowing).toBe(true);
      expect(item.isMemberThroughSection).toBe(false);
    }
  });

  it('6. a Group related through both Section membership AND an explicit follow: exactly one row, both flags true - never duplicated', async () => {
    const group = buildGroup({ id: 'group-1' });
    const section = buildSection({ id: 'section-1', parentGroup: group });
    const service = buildService({
      memberships: [buildMembership('section-1')],
      sectionsByIds: [section],
      groups: [group],
      followedGroupIds: ['group-1'],
    });

    const myGroups = await service.getMyGroups('user-1', PAGE);

    expect(myGroups.total).toBe(1);
    expect(myGroups.items[0]).toMatchObject({
      id: 'group-1',
      isMemberThroughSection: true,
      isFollowing: true,
    });
  });

  it('7. nearbySections excludes the caller own Sections', async () => {
    const mine = buildSection({
      id: 'section-mine',
      latitude: 52.4064,
      longitude: 16.9252,
    });
    const other = buildSection({
      id: 'section-other',
      latitude: 52.41,
      longitude: 16.93,
    });
    const service = buildService({
      location: buildLocation(),
      memberships: [buildMembership('section-mine')],
      sectionsByIds: [mine],
      nearbyCandidates: [mine, other],
    });

    const nearby = await service.getNearbySections('user-1', {
      ...PAGE,
      radiusKm: 300,
    });

    expect(nearby.items.map((s) => s.id)).toEqual(['section-other']);
  });

  it('8. nearbyGroups excludes every Group already in myGroups', async () => {
    const myGroup = buildGroup({ id: 'group-mine' });
    const mySection = buildSection({
      id: 'section-mine',
      parentGroup: myGroup,
      latitude: 52.4064,
      longitude: 16.9252,
    });
    const otherGroup = buildGroup({ id: 'group-other' });
    const otherSection = buildSection({
      id: 'section-other',
      parentGroup: otherGroup,
      latitude: 52.41,
      longitude: 16.93,
    });
    const service = buildService({
      location: buildLocation(),
      memberships: [buildMembership('section-mine')],
      sectionsByIds: [mySection],
      nearbyCandidates: [mySection, otherSection],
      groups: [myGroup],
      followedGroupIds: [],
    });

    const nearbyGroups = await service.getNearbyGroups('user-1', {
      ...PAGE,
      radiusKm: 300,
    });

    expect(nearbyGroups.items.map((g) => g.id)).toEqual(['group-other']);
  });

  it('9. nearbyGroups uses the nearest of a Group multiple candidate Sections', async () => {
    const group = buildGroup({ id: 'group-1' });
    const near = buildSection({
      id: 'section-near',
      name: 'Near',
      parentGroup: group,
      latitude: 52.4064,
      longitude: 16.9252,
    });
    const far = buildSection({
      id: 'section-far',
      name: 'Far',
      parentGroup: group,
      latitude: 53.0,
      longitude: 17.5,
    });
    const service = buildService({
      location: buildLocation(),
      memberships: [],
      sectionsByIds: [],
      nearbyCandidates: [far, near],
      groups: [],
      followedGroupIds: [],
    });

    const nearbyGroups = await service.getNearbyGroups('user-1', {
      ...PAGE,
      radiusKm: 300,
    });

    expect(nearbyGroups.total).toBe(1);
    expect(nearbyGroups.items[0].nearestSection.id).toBe('section-near');
    expect(nearbyGroups.items[0].sectionsCountInRadius).toBe(2);
  });

  it('10. no discovery location configured: nearbySections/nearbyGroups are empty, mySections/myGroups still work', async () => {
    const group = buildGroup({ id: 'group-1' });
    const section = buildSection({ id: 'section-1', parentGroup: group });
    const service = buildService({
      location: null,
      memberships: [buildMembership('section-1')],
      sectionsByIds: [section],
      mySectionsPage: [[section], 1],
      groups: [group],
      followedGroupIds: [],
    });

    const location = await service.getLocationSummary('user-1');
    expect(location).toEqual({ configured: false });

    const nearbySections = await service.getNearbySections('user-1', PAGE);
    expect(nearbySections).toEqual({ items: [], total: 0, hasMore: false });

    const nearbyGroups = await service.getNearbyGroups('user-1', PAGE);
    expect(nearbyGroups).toEqual({ items: [], total: 0, hasMore: false });

    const mySections = await service.getMySections('user-1', PAGE);
    expect(mySections.total).toBe(1);

    const myGroups = await service.getMyGroups('user-1', PAGE);
    expect(myGroups.total).toBe(1);
  });
});
