/**
 * Unit tests for backfillSectionCoordinates - the idempotent, re-runnable
 * script that fills in `sections.latitude`/`sections.longitude` for every
 * Section that pre-dates SectionsService deriving them from geonameId at
 * create/update time (see this feature's own report). Covers:
 *  1. a Section with geonameId set and no coordinates -> backfilled from the
 *     bundled GeoNames dataset (exact match)
 *  2. a Section that already has coordinates -> left completely untouched,
 *     counted as "already had coordinates" (idempotency - re-running never
 *     re-derives an already-resolved row)
 *  3. a legacy Section (no geonameId) whose city/country resolve to exactly
 *     one bundled record -> backfilled by name match
 *  4. a legacy Section whose city name is ambiguous within its country
 *     (two real, distinct places share the name, and the Section's own
 *     region does not disambiguate) -> reported unresolved, never assigned
 *     a guessed coordinate
 *  5. a Section with no city/country data at all -> reported unresolved
 *  6. a second run over rows the first run already resolved -> zero
 *     additional backfills, zero writes
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { getCityByGeonameId } from '../../common/geo/city-directory';
import { Section } from '../../groups/entities/section.entity';
import { GroupStatus } from '../../groups/enums/group-status.enum';
import { backfillSectionCoordinates } from './backfill-section-coordinates';

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Test Section';
  section.status = GroupStatus.ACTIVE;
  section.isPublic = true;
  section.isHidden = false;
  section.latitude = null;
  section.longitude = null;
  section.geonameId = null;
  section.country = null;
  section.city = null;
  section.region = null;
  return Object.assign(section, overrides);
}

function buildEm(sections: Section[]) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const find = jest.fn((entity: unknown) => {
    if (entity === Section) return Promise.resolve(sections);
    throw new Error(`Unexpected find entity: ${String(entity)}`);
  });
  return { find, flush } as unknown as EntityManager;
}

// Poznań, PL - a single, unambiguous bundled record (used throughout
// community-overview.service.spec.ts's own fixtures too).
const POZNAN_GEONAME_ID = 3088171;
const poznanRecord = getCityByGeonameId(POZNAN_GEONAME_ID)!;

// "Piaski" - two real, distinct Polish towns share this exact name (see
// city-search.service.ts's own comment) - a genuine ambiguous-match case
// from the real bundled dataset, not a fabricated fixture.
const PIASKI_LUBLIN_GEONAME_ID = 762390;
const piaskiLublinRecord = getCityByGeonameId(PIASKI_LUBLIN_GEONAME_ID)!;

describe('backfillSectionCoordinates', () => {
  it('1. geonameId set, no coordinates: backfilled from the bundled dataset', async () => {
    const section = buildSection({
      geonameId: POZNAN_GEONAME_ID,
      country: 'PL',
      city: 'Poznań',
      region: 'Greater Poland',
    });
    const em = buildEm([section]);

    const result = await backfillSectionCoordinates(em);

    expect(result).toMatchObject({
      totalSections: 1,
      alreadyHadCoordinates: 0,
      backfilledByGeonameId: 1,
      backfilledByCityMatch: 0,
      unresolved: [],
    });
    expect(section.latitude).toBe(poznanRecord.latitude);
    expect(section.longitude).toBe(poznanRecord.longitude);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
    expect(em.flush).toHaveBeenCalledTimes(1);
  });

  it('2. a Section that already has coordinates is left untouched and never re-derived', async () => {
    const section = buildSection({
      geonameId: POZNAN_GEONAME_ID,
      latitude: 1.23,
      longitude: 4.56,
    });
    const em = buildEm([section]);

    const result = await backfillSectionCoordinates(em);

    expect(result).toMatchObject({
      totalSections: 1,
      alreadyHadCoordinates: 1,
      backfilledByGeonameId: 0,
      backfilledByCityMatch: 0,
      unresolved: [],
    });
    // Untouched - not overwritten with the geonameId's own coordinates.
    expect(section.latitude).toBe(1.23);
    expect(section.longitude).toBe(4.56);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('3. a legacy Section (no geonameId) with an unambiguous city/country match is backfilled by name', async () => {
    const section = buildSection({
      geonameId: null,
      country: 'PL',
      city: 'Poznań',
      region: null,
    });
    const em = buildEm([section]);

    const result = await backfillSectionCoordinates(em);

    expect(result).toMatchObject({
      backfilledByGeonameId: 0,
      backfilledByCityMatch: 1,
      unresolved: [],
    });
    expect(section.latitude).toBe(poznanRecord.latitude);
    expect(section.longitude).toBe(poznanRecord.longitude);
  });

  it('4. an ambiguous city name (no geonameId, region does not disambiguate) is reported unresolved, never guessed', async () => {
    const section = buildSection({
      id: 'section-ambiguous',
      geonameId: null,
      country: 'PL',
      city: 'Piaski',
      region: null,
    });
    const em = buildEm([section]);

    const result = await backfillSectionCoordinates(em);

    expect(result.backfilledByCityMatch).toBe(0);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        sectionId: 'section-ambiguous',
        reason: 'AMBIGUOUS_NAME_MATCH',
      }),
    ]);
    expect(section.latitude).toBeNull();
    expect(section.longitude).toBeNull();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('4b. an ambiguous city name IS resolved once the Section also carries the matching region', async () => {
    const section = buildSection({
      id: 'section-region-disambiguated',
      geonameId: null,
      country: 'PL',
      city: 'Piaski',
      region: 'Lublin',
    });
    const em = buildEm([section]);

    const result = await backfillSectionCoordinates(em);

    expect(result.backfilledByCityMatch).toBe(1);
    expect(section.latitude).toBe(piaskiLublinRecord.latitude);
    expect(section.longitude).toBe(piaskiLublinRecord.longitude);
  });

  it('5. no city/country data at all: reported unresolved (NO_CITY_DATA)', async () => {
    const section = buildSection({ id: 'section-bare' });
    const em = buildEm([section]);

    const result = await backfillSectionCoordinates(em);

    expect(result.unresolved).toEqual([
      expect.objectContaining({
        sectionId: 'section-bare',
        reason: 'NO_CITY_DATA',
      }),
    ]);
  });

  it('6. idempotent: a second run over already-resolved rows backfills nothing further and never flushes', async () => {
    const section = buildSection({
      geonameId: POZNAN_GEONAME_ID,
      country: 'PL',
      city: 'Poznań',
      region: 'Greater Poland',
    });
    const em = buildEm([section]);

    await backfillSectionCoordinates(em);
    (em.flush as jest.Mock).mockClear();

    const second = await backfillSectionCoordinates(em);

    expect(second).toMatchObject({
      alreadyHadCoordinates: 1,
      backfilledByGeonameId: 0,
      backfilledByCityMatch: 0,
      unresolved: [],
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
    expect(em.flush).not.toHaveBeenCalled();
  });
});
