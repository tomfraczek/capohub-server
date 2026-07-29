// Row shape for GET /discovery/cities - see CitySearchService. The backend
// now runs on official GeoNames data (see common/geo/city-directory.ts),
// which carries a real, stable `geonameId` per place - this is the value
// Group/Section create/update expect back (see
// group-validation.helpers.ts#refineCityIdentification), alongside `name`/
// `country`/`region` for display and to fill in those same fields.
export interface CityResultDto {
  geonameId: number;
  name: string;
  country: string;
  // The admin1 region name (e.g. "Mazovia") whenever the dataset resolves
  // one for this city (see city-directory.ts) - `null` only when the
  // source itself has no admin1 code for this one city. Always present
  // when available: never withheld based on `search`, `limit`, or whether
  // some other row in the same response happens to share this `name` - a
  // stable per-city fact, not a function of the rest of the result set
  // (see CitySearchService.search).
  region: string | null;
}
