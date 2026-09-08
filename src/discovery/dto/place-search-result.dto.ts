// Row shape for GET /discovery/places - the manual "wyszukaj miejscowość"
// step of discovery-location (see users/user-location.service.ts). Unlike
// CityResultDto (GET /discovery/cities, scoped to one pre-chosen country
// for Group/Section create/update), this searches across every country at
// once and always carries real coordinates - a caller only ever has a bare
// typed place name here, never a country to scope by first, and the whole
// point of this endpoint is producing usable lat/lng without any device
// location permission or third-party geocoding provider (see
// city-search.service.ts#searchPlaces and common/geo/city-directory.ts for
// the underlying static reference dataset).
export interface PlaceSearchResultDto {
  geonameId: number;
  city: string;
  region: string | null;
  // ISO 3166-1 alpha-2 country code - the exact shape
  // PUT /users/me/discovery-location's own `countryCode` field expects, so
  // a selected result can be forwarded there with no remapping.
  countryCode: string;
  latitude: number;
  longitude: number;
}
