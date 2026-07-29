/**
 * Unit tests for CitySearchService.
 *
 * Covers:
 *  - only cities of the given country are returned,
 *  - `search` narrows by a case-insensitive substring match,
 *  - results are capped at `limit`,
 *  - results are sorted predictably (alphabetically by name),
 *  - no duplicate (name, region) pairs are ever returned,
 *  - `region` is always present when the dataset resolves one for a city -
 *    stable across `search`/`limit`, never dependent on whether some other
 *    same-named city also happens to appear in the same response,
 *  - two different cities sharing a name are distinguished by their own,
 *    independently-correct `region`,
 *  - the known "local name" limitation (see city-directory.ts) is
 *    documented by an explicit regression test, not silently assumed.
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

  it('only returns cities belonging to the requested country', () => {
    const results = service.search(buildQuery({ country: 'PL' }));

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((city) => city.country === 'PL')).toBe(true);
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

  it('caps the number of results at the requested limit', () => {
    const results = service.search(buildQuery({ country: 'PL', limit: 5 }));

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('sorts results predictably by name', () => {
    const results = service.search(buildQuery({ country: 'PL', limit: 50 }));
    const names = results.map((city) => city.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('never returns duplicate (name, region) pairs', () => {
    const results = service.search(buildQuery({ country: 'PL', limit: 50 }));
    const keys = results.map((city) => `${city.name}|${city.region ?? ''}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('distinguishes two different cities that share a name via their own, independently-correct region', () => {
    // Poland has two different cities named "Piaski" (see city-directory's
    // own fixture data) in two different regions - both must appear, each
    // with its own non-null, distinct region.
    const results = service.search(
      buildQuery({ country: 'PL', search: 'Piaski', limit: 50 }),
    );
    const piaskiEntries = results.filter((city) => city.name === 'Piaski');
    expect(piaskiEntries).toHaveLength(2);
    expect(piaskiEntries.every((city) => city.region !== null)).toBe(true);
    expect(new Set(piaskiEntries.map((city) => city.region)).size).toBe(2);
  });

  it('always includes region when the dataset resolves one, regardless of search/limit/other results - never only when a name is ambiguous', () => {
    // Poznań has exactly one match under this search term (no same-named
    // city anywhere else in the response) - region must still be present.
    const narrow = service.search(
      buildQuery({ country: 'PL', search: 'Poznań', limit: 50 }),
    );
    expect(narrow).toEqual([
      { name: 'Poznań', country: 'PL', region: 'Greater Poland' },
    ]);

    // Same city, unfiltered and with a much larger page (the query schema
    // caps `limit` at 50 for the real endpoint - see
    // city-search-query.schema.ts - but the service itself takes whatever
    // it's given, so a large value here simply proves the region does not
    // depend on `search` narrowing the result set) - identical region
    // either way, proving it is not a function of `search` or `limit`.
    const wide = service.search(buildQuery({ country: 'PL', limit: 3000 }));
    const poznanInWideResults = wide.find((city) => city.name === 'Poznań');
    expect(poznanInWideResults?.region).toBe('Greater Poland');
  });

  it('returns an empty array for a country with no known cities', () => {
    expect(service.search(buildQuery({ country: 'AQ' }))).toEqual([]);
  });

  // Regression coverage for the disclosed "local name" limitation (see
  // city-directory.ts's own comment for the full investigation): the
  // bundled dataset stores a handful of internationally prominent cities,
  // Poland's capital included, under their common English exonym rather
  // than the local-language name, and has no alternate/local name data to
  // recover it from. This test documents *today's actual* behavior so a
  // future change to the underlying data source is a deliberate, visible
  // change to this test, not a silent regression either way.
  it('[known limitation] finds the capital by its English exonym "Warsaw", not yet by its local name "Warszawa"', () => {
    const byExonym = service.search(
      buildQuery({ country: 'PL', search: 'Warsaw' }),
    );
    expect(byExonym.some((city) => city.name === 'Warsaw')).toBe(true);

    const byLocalName = service.search(
      buildQuery({ country: 'PL', search: 'Warszawa' }),
    );
    expect(byLocalName.some((city) => city.name === 'Warsaw')).toBe(false);
  });
});
