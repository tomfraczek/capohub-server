/**
 * Unit tests for CitySearchService.
 *
 * Covers:
 *  - only cities of the given country are returned, each with a geonameId,
 *  - `search` narrows by a case-insensitive substring match on name,
 *  - `search` also matches GeoNames alternate names, so a local name (e.g.
 *    "Warszawa") resolves to the same record as its English exonym
 *    ("Warsaw") - same geonameId, same displayed name,
 *  - results are capped at `limit`,
 *  - results are sorted predictably (name, then region, then geonameId),
 *  - two different cities sharing a name are distinguished by their own,
 *    independently-correct geonameId and region,
 *  - `region` is always present when the dataset resolves one for a city -
 *    stable across `search`/`limit`.
 */

import { CitySearchService } from './city-search.service';
import { CitySearchQuery } from './dto/city-search-query.schema';

function buildQuery(overrides: Partial<CitySearchQuery> = {}): CitySearchQuery {
  return {
    country: 'PL',
    limit: 20,
    ...overrides,
  };
}

describe('CitySearchService', () => {
  let service: CitySearchService;

  beforeEach(() => {
    service = new CitySearchService();
  });

  it('only returns cities belonging to the requested country, each with a geonameId', () => {
    const results = service.search(buildQuery({ country: 'PL' }));

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((city) => city.country === 'PL')).toBe(true);
    expect(results.every((city) => Number.isInteger(city.geonameId))).toBe(
      true,
    );
  });

  it('narrows results by a case-insensitive substring match on name', () => {
    const results = service.search(
      buildQuery({ country: 'PL', search: 'pozna' }),
    );

    expect(results.some((city) => city.name === 'Poznań')).toBe(true);
    expect(
      results.every((city) => city.name.toLowerCase().includes('pozna')),
    ).toBe(true);
  });

  // The GeoNames record for Poland's capital ("Warsaw") lists "Warszawa"
  // among its alternate names - searching either term must resolve to the
  // exact same record (see city-directory.ts).
  it('finds the same record via a GeoNames alternate name as via its own displayed name', () => {
    const byExonym = service.search(
      buildQuery({ country: 'PL', search: 'Warsaw' }),
    );
    const byLocalName = service.search(
      buildQuery({ country: 'PL', search: 'Warszawa' }),
    );

    expect(byExonym).toHaveLength(1);
    expect(byLocalName).toHaveLength(1);
    expect(byExonym[0]).toEqual(byLocalName[0]);
    expect(byExonym[0]).toMatchObject({
      geonameId: 756135,
      name: 'Warsaw',
      country: 'PL',
      region: 'Mazovia',
    });
  });

  it('caps the number of results at the requested limit', () => {
    const results = service.search(buildQuery({ country: 'PL', limit: 5 }));

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('sorts results predictably by name', () => {
    const results = service.search(buildQuery({ country: 'PL', limit: 50 }));
    const names = results.map((city) => city.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('never returns duplicate geonameIds', () => {
    const results = service.search(buildQuery({ country: 'PL', limit: 50 }));
    const ids = results.map((city) => city.geonameId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('distinguishes two different cities that share a name via their own distinct geonameId and region', () => {
    // Poland has two different cities named "Piaski" (see city-directory's
    // own fixture data) in two different regions - both must appear, each
    // with its own distinct geonameId and region.
    const results = service.search(
      buildQuery({ country: 'PL', search: 'Piaski', limit: 50 }),
    );
    const piaskiEntries = results.filter((city) => city.name === 'Piaski');
    expect(piaskiEntries).toHaveLength(2);
    expect(new Set(piaskiEntries.map((city) => city.geonameId)).size).toBe(2);
    expect(piaskiEntries.every((city) => city.region !== null)).toBe(true);
    expect(new Set(piaskiEntries.map((city) => city.region)).size).toBe(2);
  });

  it('always includes region when the dataset resolves one, regardless of search/limit', () => {
    const narrow = service.search(
      buildQuery({ country: 'PL', search: 'Poznań', limit: 50 }),
    );
    expect(narrow).toEqual([
      {
        geonameId: 3088171,
        name: 'Poznań',
        country: 'PL',
        region: 'Greater Poland',
      },
    ]);

    // Same city, unfiltered and with a much larger page (the query schema
    // caps `limit` at 50 for the real endpoint - see
    // city-search-query.schema.ts - but the service itself takes whatever
    // it's given, so a large value here simply proves the region does not
    // depend on `search` narrowing the result set) - identical region
    // either way, proving it is not a function of `search` or `limit`.
    const wide = service.search(buildQuery({ country: 'PL', limit: 3000 }));
    const poznanInWideResults = wide.find((city) => city.geonameId === 3088171);
    expect(poznanInWideResults?.region).toBe('Greater Poland');
  });

  it('returns an empty array for a country with no known cities', () => {
    expect(service.search(buildQuery({ country: 'AQ' }))).toEqual([]);
  });
});
