/**
 * Unit tests for CommunityHomeService's discovery-fallback orchestration
 * (resolveDiscoveryFallback, invoked from getHome) - see this feature's own
 * report, "Community Home nie może być pusty", and
 * CommunityDiscoveryContextDto's own comment on the three fallbackType
 * states. Covers:
 *  1. no discovery location configured -> fallbackType 'NONE', no expanded/
 *     country queries issued at all
 *  2. nearby (50km) already has results -> fallbackType 'NONE', no
 *     expanded/country queries issued
 *  3. nearby empty, expanded radius (150km) has results -> fallbackType
 *     'EXPANDED_RADIUS', discoverySections/discoveryGroups hold that result
 *  4. nearby AND expanded both empty, country tier has results ->
 *     fallbackType 'COUNTRY'
 *  5. every tier empty -> fallbackType 'NONE', discoverySections/
 *     discoveryGroups stay empty (never an error/empty screen)
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { EXPANDED_NEARBY_RADIUS_KM } from './community-overview.constants';
import { CommunityHomeService } from './community-home.service';
import { CommunityOverviewService } from './community-overview.service';
import { CommunityLocationContext } from './dto/community-location-context.schema';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupPermissionService } from './permissions/group-permission.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { MembershipRequestsService } from './membership-requests.service';
import { R2StorageService } from '../storage/r2-storage.service';

interface BoundedSection {
  items: unknown[];
  total: number;
  hasMore: boolean;
}

const EMPTY: BoundedSection = { items: [], total: 0, hasMore: false };

const CONFIGURED_LOCATION: CommunityLocationContext = {
  latitude: 52.4064,
  longitude: 16.9252,
  countryCode: 'PL',
  city: 'Poznań',
  region: null,
};

function buildUser(): User {
  const user = new User();
  user.id = 'user-1';
  return user;
}

interface OverviewRouting {
  location: { configured: boolean };
  nearbySections?: BoundedSection;
  nearbyGroups?: BoundedSection;
  expandedSections?: BoundedSection;
  expandedGroups?: BoundedSection;
  countrySections?: BoundedSection;
  countryGroups?: BoundedSection;
}

function buildService(routing: OverviewRouting) {
  const em = {
    find: jest.fn().mockResolvedValue([]),
    // Backs canCreateGroup's hasActiveFormalGroup check - irrelevant to
    // this file's discovery-fallback focus, always "no active formal
    // group".
    count: jest.fn().mockResolvedValue(0),
  } as unknown as EntityManager;

  const getNearbySections = jest.fn(
    (
      _userId: string,
      _location: CommunityLocationContext | null,
      params: { radiusKm?: number },
    ) => {
      // Home now always passes its own (caller-chosen) radius - only the
      // expanded tier's EXPANDED_NEARBY_RADIUS_KM call is routed to it.
      if (params.radiusKm === EXPANDED_NEARBY_RADIUS_KM) {
        return Promise.resolve(routing.expandedSections ?? EMPTY);
      }
      return Promise.resolve(routing.nearbySections ?? EMPTY);
    },
  );
  const getNearbyGroups = jest.fn(
    (
      _userId: string,
      _location: CommunityLocationContext | null,
      params: { radiusKm?: number },
    ) => {
      // Home now always passes its own (caller-chosen) radius - only the
      // expanded tier's EXPANDED_NEARBY_RADIUS_KM call is routed to it.
      if (params.radiusKm === EXPANDED_NEARBY_RADIUS_KM) {
        return Promise.resolve(routing.expandedGroups ?? EMPTY);
      }
      return Promise.resolve(routing.nearbyGroups ?? EMPTY);
    },
  );
  const getCountryDiscoverySections = jest
    .fn()
    .mockResolvedValue(routing.countrySections ?? EMPTY);
  const getCountryDiscoveryGroups = jest
    .fn()
    .mockResolvedValue(routing.countryGroups ?? EMPTY);

  const communityOverviewService = {
    getLocationSummary: jest.fn().mockReturnValue(routing.location),
    getMySections: jest.fn().mockResolvedValue(EMPTY),
    getMyGroups: jest.fn().mockResolvedValue(EMPTY),
    getNearbySections,
    getNearbyGroups,
    getCountryDiscoverySections,
    getCountryDiscoveryGroups,
  } as unknown as CommunityOverviewService;

  const roleAssignmentsService = {
    getGroupParticipationForUsers: jest.fn().mockResolvedValue([]),
  } as unknown as RoleAssignmentsService;
  const groupHierarchyService = {} as unknown as GroupHierarchyService;
  const membershipRequestsService = {
    listReceivedInvitations: jest.fn().mockResolvedValue([]),
    listJoinRequestsForGroups: jest.fn().mockResolvedValue([]),
  } as unknown as MembershipRequestsService;
  const groupPermissionService = new GroupPermissionService();
  const r2StorageService = {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;

  const service = new CommunityHomeService(
    em,
    groupPermissionService,
    roleAssignmentsService,
    groupHierarchyService,
    membershipRequestsService,
    r2StorageService,
    communityOverviewService,
  );

  return {
    service,
    getNearbySections,
    getNearbyGroups,
    getCountryDiscoverySections,
    getCountryDiscoveryGroups,
  };
}

describe('CommunityHomeService - discovery fallback', () => {
  it('1. no discovery location configured: fallbackType NONE, no expanded/country queries at all', async () => {
    const { service, getNearbySections, getCountryDiscoverySections } =
      buildService({ location: { configured: false } });

    const home = await service.getHome(buildUser(), null);

    expect(home.discoveryContext).toEqual({
      nearbyRadiusKm: 50,
      expandedRadiusKm: 150,
      fallbackType: 'NONE',
    });
    expect(home.discoverySections).toEqual(EMPTY);
    expect(home.discoveryGroups).toEqual(EMPTY);
    // Exactly one call - Home's own default-radius nearbySections read -
    // never a second, expanded-radius call.
    expect(getNearbySections).toHaveBeenCalledTimes(1);
    expect(getCountryDiscoverySections).not.toHaveBeenCalled();
  });

  it('2. nearby (50km) already has results: fallbackType NONE, no expanded/country queries', async () => {
    const { service, getNearbySections, getCountryDiscoverySections } =
      buildService({
        location: { configured: true },
        nearbySections: {
          items: [{ id: 'section-1' }],
          total: 1,
          hasMore: false,
        },
      });

    const home = await service.getHome(buildUser(), CONFIGURED_LOCATION);

    expect(home.discoveryContext.fallbackType).toBe('NONE');
    expect(getNearbySections).toHaveBeenCalledTimes(1);
    expect(getCountryDiscoverySections).not.toHaveBeenCalled();
  });

  it('3. nearby empty, expanded radius (150km) has results: fallbackType EXPANDED_RADIUS', async () => {
    const expandedSections = {
      items: [{ id: 'section-far', distanceKm: 120 }],
      total: 1,
      hasMore: false,
    };
    const { service, getCountryDiscoverySections } = buildService({
      location: { configured: true },
      expandedSections,
    });

    const home = await service.getHome(buildUser(), CONFIGURED_LOCATION);

    expect(home.discoveryContext.fallbackType).toBe('EXPANDED_RADIUS');
    expect(home.discoverySections).toEqual(expandedSections);
    expect(getCountryDiscoverySections).not.toHaveBeenCalled();
  });

  // The radius is a per-request filter (mobile "Odkryj sekcje" slider):
  // Home's own nearby read and discoveryContext.nearbyRadiusKm must both
  // follow it, never a fixed 50km.
  it('uses the caller-chosen radiusKm for its own nearby read and echoes it as nearbyRadiusKm', async () => {
    const { service, getNearbySections, getNearbyGroups } = buildService({
      location: { configured: true },
      nearbySections: {
        items: [{ id: 'section-1' }],
        total: 1,
        hasMore: false,
      },
    });

    const home = await service.getHome(buildUser(), CONFIGURED_LOCATION, 25);

    expect(getNearbySections).toHaveBeenCalledWith(
      expect.any(String),
      CONFIGURED_LOCATION,
      expect.objectContaining({ radiusKm: 25 }),
    );
    expect(getNearbyGroups).toHaveBeenCalledWith(
      expect.any(String),
      CONFIGURED_LOCATION,
      expect.objectContaining({ radiusKm: 25 }),
    );
    expect(home.discoveryContext.nearbyRadiusKm).toBe(25);
  });

  it('4. nearby AND expanded both empty, country tier has results: fallbackType COUNTRY', async () => {
    const countrySections = {
      items: [{ id: 'section-country' }],
      total: 1,
      hasMore: false,
    };
    const { service } = buildService({
      location: { configured: true },
      countrySections,
    });

    const home = await service.getHome(buildUser(), CONFIGURED_LOCATION);

    expect(home.discoveryContext.fallbackType).toBe('COUNTRY');
    expect(home.discoverySections).toEqual(countrySections);
  });

  it('5. every tier empty: fallbackType NONE, discoverySections/discoveryGroups stay empty (never an error)', async () => {
    const { service } = buildService({ location: { configured: true } });

    const home = await service.getHome(buildUser(), CONFIGURED_LOCATION);

    expect(home.discoveryContext.fallbackType).toBe('NONE');
    expect(home.discoverySections).toEqual(EMPTY);
    expect(home.discoveryGroups).toEqual(EMPTY);
  });
});
