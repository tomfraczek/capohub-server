// Great-circle distance helpers backing nearby Section/Group discovery (see
// groups/community-overview.service.ts). Correct, dependency-free
// application-code distance math over plain latitude/longitude columns -
// deliberately not PostGIS/a spatial index: this codebase has no spatial
// extension enabled and does not need one at current data volume (module:
// "Dla obecnej skali można użyć poprawnego obliczania dystansu na
// latitude/longitude"). The one thing that *is* done to keep this cheap at
// the DB layer is `nearbyBoundingBox` below, a plain-SQL pre-filter (a btree
// range scan over Section's own (latitude, longitude) index - see
// section.entity.ts) that only ever *over-selects* candidates, never
// under-selects them; `haversineKm` then scores/filters that already-small
// candidate set exactly. If this ever needs to scale past what a bounding
// box + in-memory haversine comfortably handles, the natural next step is a
// PostGIS `geography` column with a GiST index and `ST_DWithin` - nothing
// here is designed to make that migration harder, since both approaches
// start from the same "candidates, then exact distance" shape.
const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two coordinates, in kilometers, via the
 * haversine formula. Exact (not an approximation like the bounding box
 * below) - safe to sort/filter/display by.
 */
export function haversineKm(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const dLat = toRadians(toLatitude - fromLatitude);
  const dLon = toRadians(toLongitude - fromLongitude);
  const lat1 = toRadians(fromLatitude);
  const lat2 = toRadians(toLatitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/**
 * A rectangular over-approximation of "within `radiusKm` of (latitude,
 * longitude)" - cheap for Postgres to range-scan via a plain btree index
 * (see section.entity.ts's (latitude, longitude) index), at the cost of
 * including some corner candidates that are actually slightly further than
 * `radiusKm` away (a circle's bounding square). Callers MUST still filter
 * the resulting candidates through `haversineKm` for an exact radius/sort -
 * this function alone is never precise enough to trust as the final answer.
 *
 * Longitude degrees shrink toward the poles (a degree of longitude is
 * `cos(latitude)` times shorter than a degree of latitude), so the
 * longitude delta is widened by `1 / cos(latitude)` - clamped away from the
 * poles (|latitude| > 89.9) where that factor would blow up towards
 * infinity for a query location that will realistically never occur for a
 * capoeira Section/Group anyway.
 */
export function nearbyBoundingBox(
  latitude: number,
  longitude: number,
  radiusKm: number,
): BoundingBox {
  const latDelta = radiusKm / (EARTH_RADIUS_KM * (Math.PI / 180));
  const clampedLatitude = Math.min(Math.abs(latitude), 89.9);
  const lonDelta =
    radiusKm /
    (EARTH_RADIUS_KM * (Math.PI / 180) * Math.cos(toRadians(clampedLatitude)));

  return {
    minLatitude: Math.max(latitude - latDelta, -90),
    maxLatitude: Math.min(latitude + latDelta, 90),
    // Deliberately not wrapped at the +-180 antimeridian - a query location
    // near it would produce a box that misses candidates just across the
    // seam. Not handled at current scale/scope; note this alongside any
    // future PostGIS migration (see this module's class comment).
    minLongitude: longitude - lonDelta,
    maxLongitude: longitude + lonDelta,
  };
}
