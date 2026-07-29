// Row shape for GET /discovery/cities - see CitySearchService. Deliberately
// has no `id`: the underlying dataset (`cities.json`, see
// common/geo/city-directory.ts) carries no stable per-city identifier at
// all (its shape is just name/lat/lng/country/admin1/admin2 - confirmed by
// inspecting the package's own data and type declarations). A handful of
// other small city packages were checked too (`all-the-cities` does carry
// a genuine GeoNames geonameid as `cityId`) - but adopting one of those
// would mean swapping the whole data source (and its search/region/
// country-match behavior, all of which already work correctly against
// `cities.json`), not adding an id to the one already in use, so it was
// left alone here. `city` is stored as plain text on Group/Section (not a
// foreign key) regardless, so there is nothing for an id to reference
// today either way - the frontend already has everything it needs to both
// display and submit a choice (`name`).
export interface CityResultDto {
  name: string;
  country: string;
  // The admin1 region name (e.g. "Mazovia") whenever the dataset resolves
  // one for this city (see city-directory.ts) - `null` only when the
  // source itself has no admin1 code, or no matching admin1.json entry, for
  // this one city. Always present when available: never withheld based on
  // `search`, `limit`, or whether some other row in the same response
  // happens to share this `name` - a stable per-city fact, not a function
  // of the rest of the result set (see CitySearchService.search).
  region: string | null;
}
