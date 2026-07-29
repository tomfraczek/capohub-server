import cities from 'cities.json';
import admin1 from 'cities.json/admin1';

// Backs both the city-search endpoint (see discovery/city-search.service.ts)
// and the Group/Section country<->city cross-validation
// (see groups/dto/group-validation.helpers.ts#refineCityMatchesCountry) -
// one shared dataset/index, never two, so "which cities can I search for"
// and "which city values are accepted on create/update" can never drift
// apart.
//
// Data source: the `cities.json` npm package (CC BY 4.0), itself derived
// from the GeoNames Gazetteer (https://www.geonames.org) - every city
// worldwide with population > 1000, or an administrative seat down to
// PPLA3 (~170k rows total), updated monthly upstream. Chosen over a
// hand-rolled dataset (see iso-3166-alpha2.ts's own reasoning for *not*
// doing that for country codes) because city names, unlike the fixed set
// of ISO country codes, are far too large and far too frequently
// reorganized (renames, new administrative seats) to maintain by hand -
// and over a live geocoding API because this app has no requirement for
// real-time freshness, coordinates, or address-level lookup, so a
// bundled, offline, zero-latency dataset is the simpler fit (no API key,
// no quota, no network dependency for a purely server-side lookup - see
// the module's own "why" in package.json).
//
// Known, disclosed limitation - local names: for a set of internationally
// prominent cities (not only capitals - e.g. also Naples, Florence, Milan,
// Turin, Antwerp), GeoNames' own `name` *and* `asciiname` columns already
// store the common English exonym rather than the local-language name (a
// property of the upstream GeoNames record itself, confirmed directly
// against GeoNames' raw per-country dump - e.g. geonameid 756135, Poland's
// capital, has `name=asciiname="Warsaw"`; there is no ASCII/locale split to
// recover "Warszawa" from within this dump). The `cities.json` package (and
// every other small, offline-bundled city package checked - `all-the-
// cities`, `worldcities` - same story) only ever exposes this one `name`
// column, so none of them can distinguish "the local name" from "the name
// GeoNames chose to display".
//
// The local name *does* exist in GeoNames' data, but only in the separate
// `alternateNamesV2` dataset (columns: geonameid, isolanguage, alternate
// name, isPreferredName, ...) - confirmed directly: geonameid 756135 has a
// row `isolanguage=pl, alternate name=Warszawa, isPreferredName=1`.
// Resolving it correctly (not by guessing) means, for every city, joining
// its geonameid against the alternate-name row tagged with that country's
// own official language and `isPreferredName=1`. Two things make this
// infeasible as a small fix rather than a data-source swap in its own
// right: (1) `cities.json` has no geonameid to join on at all - a
// prerequisite switch to a package that does (e.g. `all-the-cities`) would
// itself touch every part of this module (search, region resolution via
// admin1.json, the country/city cross-check), not just the naming issue;
// (2) GeoNames only publishes alternateNamesV2 per-country or as one
// combined archive - confirmed by direct download: a single country's file
// already runs several MB (Poland's is ~6 MB / 118k rows uncompressed),
// and the combined worldwide archive is ~202 MB compressed. Ingesting it
// for every country to genuinely fix this everywhere (not just for one
// hand-picked country) is a real, separate data-pipeline project - out of
// scope here per this task's own instruction not to perform a large
// migration, and *not* a substitute for the also-forbidden manual
// Warsaw-to-Warszawa alias table: picking only some countries/cities to
// "fix" this way would, in effect, be exactly that list wearing a
// different hat.
//
// Smallest viable next step, if this becomes a real product requirement:
// swap the base dataset for one that carries a genuine geonameid (see
// CityRecord's sibling concern in city-result.dto.ts), then build a
// dedicated, versioned data-prep step that ingests alternateNamesV2 for
// every country uniformly (never a curated subset) and bundles just the
// (geonameid, isPreferredName=1, official-language) rows - a self-
// contained follow-up, not a change folded into this fix.
export interface CityRecord {
  name: string;
  country: string;
  // The admin1 division's human-readable (English) name, e.g. "Mazovia" -
  // null when the source has no admin1 code for this city, or no matching
  // admin1.json entry.
  region: string | null;
}

interface CityIndexes {
  byCountry: Map<string, CityRecord[]>;
  knownNamesByCountry: Map<string, Set<string>>;
}

// Built once per process, lazily on first use, not at module load - so
// importing this module (e.g. transitively, from a Zod schema file that
// may be loaded before it is ever actually needed) never pays the ~170k-row
// indexing cost unless a request actually requires it.
let indexes: CityIndexes | null = null;

function buildIndexes(): CityIndexes {
  const regionNameByCode = new Map<string, string>();
  for (const division of admin1) {
    regionNameByCode.set(division.code, division.name);
  }

  const byCountry = new Map<string, CityRecord[]>();
  const knownNamesByCountry = new Map<string, Set<string>>();

  for (const raw of cities) {
    const region = raw.admin1
      ? (regionNameByCode.get(`${raw.country}.${raw.admin1}`) ?? null)
      : null;

    const list = byCountry.get(raw.country);
    const record: CityRecord = { name: raw.name, country: raw.country, region };
    if (list) {
      list.push(record);
    } else {
      byCountry.set(raw.country, [record]);
    }

    const names = knownNamesByCountry.get(raw.country);
    const normalized = raw.name.trim().toLowerCase();
    if (names) {
      names.add(normalized);
    } else {
      knownNamesByCountry.set(raw.country, new Set([normalized]));
    }
  }

  return { byCountry, knownNamesByCountry };
}

function getIndexes(): CityIndexes {
  if (!indexes) {
    indexes = buildIndexes();
  }
  return indexes;
}

/**
 * Every known city for `countryCode` (an ISO 3166-1 alpha-2 code, expected
 * already-uppercased - see countryCodeSchema), in no particular order - see
 * CitySearchService for sorting/filtering/limiting. Empty array for a
 * country with no rows in the dataset (never thrown - an unrecognized or
 * obscure country code is simply "no cities", the same shape as a query
 * that legitimately matches nothing).
 */
export function getCitiesForCountry(
  countryCode: string,
): readonly CityRecord[] {
  return getIndexes().byCountry.get(countryCode) ?? [];
}

/**
 * Whether `cityName` is a known city of `countryCode` - case-insensitive,
 * trimmed, exact match against the dataset's own spelling (diacritics
 * preserved, e.g. "Poznań" - see this module's own comment on the English-
 * exonym limitation for the handful of exceptions). Backs the Group/Section
 * country<->city cross-validation (see group-validation.helpers.ts).
 */
export function isKnownCity(countryCode: string, cityName: string): boolean {
  const normalized = cityName.trim().toLowerCase();
  return (
    getIndexes().knownNamesByCountry.get(countryCode)?.has(normalized) ?? false
  );
}
