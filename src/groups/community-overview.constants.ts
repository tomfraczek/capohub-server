// Every limit/radius CommunityOverviewService uses, centralized here so
// none of it is a magic number scattered across the service - change the
// Community Home card counts or the nearby search radius in exactly one
// place. Same "plain module-level constant" convention as
// community-home.service.ts's own PENDING_SECTION_LIMIT, not env-backed:
// none of these need to differ per-deployment today, and this file is the
// one place to promote any of them to AppConfigService later if that
// changes.

// Card counts for the GET /community/home dashboard - deliberately small,
// sized for a horizontal carousel, never a real "list" (module: "Home
// zwraca ograniczoną liczbę elementów przygotowaną pod poziomą karuzelę").
// The full, paginated equivalents live behind GET
// /community/{sections,groups}/mine and /nearby (see
// CommunityOverviewController).
export const HOME_MY_SECTIONS_LIMIT = 10;
export const HOME_MY_GROUPS_LIMIT = 10;
export const HOME_NEARBY_SECTIONS_LIMIT = 10;
export const HOME_NEARBY_GROUPS_LIMIT = 10;

// Default nearby search radius, in kilometers - used whenever a caller does
// not send `?radiusKm=` (GET /community/home and the paginated nearby
// endpoints alike). The radius is always a per-request search filter, never
// a property of a stored location.
export const DEFAULT_NEARBY_RADIUS_KM = 50;
export const MAX_NEARBY_RADIUS_KM = 300;

// Upper bound of the caller-chosen search radius on GET /community/home
// (the mobile "Odkryj sekcje" radius slider). Deliberately lower than
// MAX_NEARBY_RADIUS_KM: /nearby must also accept EXPANDED_NEARBY_RADIUS_KM
// (150) for the expanded-radius tier's own "Zobacz wszystkie" list, but the
// radius a user picks themselves never goes past this - and always staying
// below EXPANDED_NEARBY_RADIUS_KM keeps the expanded tier a real widening.
export const MAX_HOME_SEARCH_RADIUS_KM = 100;

// Discovery fallback (see CommunityHomeService.getHome and this feature's
// own report, "Community Home nie może być pusty") - when the caller's own
// DEFAULT_NEARBY_RADIUS_KM search comes back with neither a nearby Section
// nor a nearby Group, Home retries once at this wider radius before falling
// back to the country-wide ranking (CommunityOverviewService.
// getCountryDiscoverySections/getCountryDiscoveryGroups) - never both tiers
// at once, and never silently expanding DEFAULT_NEARBY_RADIUS_KM itself
// (nearbySections/nearbyGroups always stay a strict 50km answer; a wider
// result is only ever surfaced through the separate discoverySections/
// discoveryGroups pair, tagged via discoveryContext.fallbackType, so the
// frontend can never mislabel an expanded-radius result as "w pobliżu").
export const EXPANDED_NEARBY_RADIUS_KM = 150;

// Card counts for Home's discoverySections/discoveryGroups fallback -
// same "capped for a carousel" convention as HOME_NEARBY_*_LIMIT above.
export const HOME_DISCOVERY_SECTIONS_LIMIT = 10;
export const HOME_DISCOVERY_GROUPS_LIMIT = 10;

// Safety cap on how many same-country candidate Section rows
// getCountryDiscoverySections/getCountryDiscoveryGroups may pull back from
// Postgres before ranking/pagination happens in application code - the
// country-fallback equivalent of NEARBY_CANDIDATE_SCAN_LIMIT below (no
// bounding box to pre-filter by here, since this tier is deliberately not
// distance-ranked - see CommunityOverviewService's own comment on the
// memberCount-based ranking).
export const DISCOVERY_CANDIDATE_SCAN_LIMIT = 500;

// Safety cap on how many Section rows the bounding-box pre-filter (see
// common/geo/distance.ts#nearbyBoundingBox) may pull back from Postgres
// before exact haversine scoring/sorting/pagination happens in application
// code - keeps one dense metro area from turning "nearby" into an
// unbounded scan. Generous relative to MAX_NEARBY_RADIUS_KM at today's data
// volume; revisit alongside a real spatial index (see distance.ts) if a
// region ever legitimately exceeds it.
export const NEARBY_CANDIDATE_SCAN_LIMIT = 2000;
