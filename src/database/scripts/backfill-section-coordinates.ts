import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../app.module';
import {
  CityRecord,
  getCitiesForCountry,
  getCityByGeonameId,
} from '../../common/geo/city-directory';
import { Section } from '../../groups/entities/section.entity';

// Backfills `sections.latitude`/`sections.longitude` for every existing
// Section that pre-dates this feature (see this feature's own report: the
// mobile city picker never sent latitude/longitude, so no create/update
// path ever populated these two columns - fixed going forward in
// SectionsService.applyFields, which now always derives them from
// `geonameId` - but that fix only ever runs on a *future* create/update,
// never on rows already sitting in the database). Nearby discovery
// (CommunityOverviewService) simply skips any Section with a null
// latitude/longitude, so an un-backfilled legacy row is invisible to it
// forever until someone happens to re-save it.
//
// Safe / idempotent / re-runnable (task: "Backfill powinien być bezpieczny,
// idempotentny, możliwy do ponownego uruchomienia"):
//  - never touches a row that already has both latitude and longitude set,
//    whether that came from a prior run of this exact script or from an
//    ordinary create/update since;
//  - never *invents* a coordinate - a row it cannot resolve unambiguously is
//    left exactly as it was and reported as unresolved, never assigned a
//    "close enough" guess (task: "NIE przypisuj przypadkowych współrzędnych,
//    raportuj taki rekord jako unresolved");
//  - re-running it after fixing/enriching a previously-unresolved row's
//    country/city/region data (or after a geonameId dataset update) simply
//    picks up whatever is still missing - every already-resolved row is a
//    guaranteed no-op.
//
// Resolution order per Section, mirroring the same "geonameId is the real
// source of truth, country/city/region are cross-checked against it" policy
// group-validation.helpers.ts#refineCityIdentification already applies to
// create/update:
//  1. geonameId set -> look it up directly in the bundled GeoNames dataset
//     (common/geo/city-directory.ts) - exact, unambiguous by construction
//     (a geonameId names exactly one real place).
//  2. no geonameId, but country+city are set (every legacy row from before
//     geonameId became mandatory) -> match by city name within that
//     country, narrowing by region too when more than one same-named city
//     exists there and the row also has a region on file. Only ever
//     resolved when exactly one candidate remains - a name that stays
//     ambiguous even after the region narrowing is reported unresolved,
//     never guessed.
//  3. anything else (no geonameId and no city/country) -> unresolved, no
//     signal to resolve from at all.
export type UnresolvedReason =
  | 'GEONAME_ID_NOT_FOUND'
  | 'NO_CITY_DATA'
  | 'NO_NAME_MATCH'
  | 'AMBIGUOUS_NAME_MATCH';

export interface UnresolvedSectionRecord {
  sectionId: string;
  name: string;
  country: string | null;
  city: string | null;
  region: string | null;
  reason: UnresolvedReason;
}

export interface BackfillSectionCoordinatesResult {
  totalSections: number;
  alreadyHadCoordinates: number;
  backfilledByGeonameId: number;
  backfilledByCityMatch: number;
  unresolved: UnresolvedSectionRecord[];
}

function findUniqueCityMatch(
  city: string,
  country: string,
  region: string | null,
): CityRecord | 'AMBIGUOUS' | null {
  const normalizedCity = city.trim().toLowerCase();
  const candidates = getCitiesForCountry(country).filter(
    (record) => record.name.trim().toLowerCase() === normalizedCity,
  );
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  // Same-named city appears more than once in this country (e.g. two
  // different Polish towns both named "Piaski" - see
  // city-search.service.ts's own comment) - only narrow by region when the
  // Section actually has one on file; otherwise stay ambiguous rather than
  // guess among several real, distinct places.
  if (region) {
    const normalizedRegion = region.trim().toLowerCase();
    const byRegion = candidates.filter(
      (record) =>
        (record.region ?? '').trim().toLowerCase() === normalizedRegion,
    );
    if (byRegion.length === 1) {
      return byRegion[0];
    }
  }
  return 'AMBIGUOUS';
}

export async function backfillSectionCoordinates(
  em: EntityManager,
): Promise<BackfillSectionCoordinatesResult> {
  // Every Section regardless of status - DELETED/ARCHIVED rows are harmless
  // to backfill too (never read by nearby discovery, which already filters
  // to status=ACTIVE - see CommunityOverviewService), and doing so keeps
  // the whole table consistent rather than leaving a status-shaped hole a
  // future unarchive/restore would silently reintroduce.
  const sections = await em.find(Section, {});

  let alreadyHadCoordinates = 0;
  let backfilledByGeonameId = 0;
  let backfilledByCityMatch = 0;
  const unresolved: UnresolvedSectionRecord[] = [];
  const toFlush: Section[] = [];

  for (const section of sections) {
    if (section.latitude !== null && section.longitude !== null) {
      alreadyHadCoordinates += 1;
      continue;
    }

    if (section.geonameId !== null) {
      const record = getCityByGeonameId(section.geonameId);
      if (record) {
        section.latitude = record.latitude;
        section.longitude = record.longitude;
        toFlush.push(section);
        backfilledByGeonameId += 1;
        continue;
      }
      // A geonameId the current bundled dataset no longer recognizes (e.g.
      // GeoNames merged/renumbered the record since this row was created) -
      // fall through to the city-name path below rather than give up
      // immediately, since country/city/region may still resolve it.
    }

    if (section.city && section.country) {
      const match = findUniqueCityMatch(
        section.city,
        section.country,
        section.region,
      );
      if (match === 'AMBIGUOUS') {
        unresolved.push({
          sectionId: section.id,
          name: section.name,
          country: section.country,
          city: section.city,
          region: section.region,
          reason: 'AMBIGUOUS_NAME_MATCH',
        });
        continue;
      }
      if (match) {
        section.latitude = match.latitude;
        section.longitude = match.longitude;
        toFlush.push(section);
        backfilledByCityMatch += 1;
        continue;
      }
      unresolved.push({
        sectionId: section.id,
        name: section.name,
        country: section.country,
        city: section.city,
        region: section.region,
        reason:
          section.geonameId !== null ? 'GEONAME_ID_NOT_FOUND' : 'NO_NAME_MATCH',
      });
      continue;
    }

    unresolved.push({
      sectionId: section.id,
      name: section.name,
      country: section.country,
      city: section.city,
      region: section.region,
      reason: 'NO_CITY_DATA',
    });
  }

  if (toFlush.length > 0) {
    await em.flush();
  }

  return {
    totalSections: sections.length,
    alreadyHadCoordinates,
    backfilledByGeonameId,
    backfilledByCityMatch,
    unresolved,
  };
}

async function bootstrap(): Promise<void> {
  // Unlike seed-music-content.ts's silent ['error', 'warn'] bootstrap, this
  // script's whole point (task: "Na końcu raportu podaj: ile sekcji dostało
  // współrzędne...") is the summary it prints on completion - keep 'log'
  // enabled so that line (and the per-row 'warn' for anything left
  // unresolved) both actually reach the console.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const em = app.get(EntityManager).fork();
    const result = await backfillSectionCoordinates(em);
    Logger.log(
      `${result.totalSections} section(s) total - ${result.alreadyHadCoordinates} already had coordinates, ` +
        `${result.backfilledByGeonameId} backfilled via geonameId, ${result.backfilledByCityMatch} backfilled via city match, ` +
        `${result.unresolved.length} unresolved`,
      'BackfillSectionCoordinates',
    );
    for (const row of result.unresolved) {
      Logger.warn(
        `Unresolved: section ${row.sectionId} ("${row.name}") - ${row.reason} ` +
          `(country=${row.country ?? 'null'}, city=${row.city ?? 'null'}, region=${row.region ?? 'null'})`,
        'BackfillSectionCoordinates',
      );
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  bootstrap().catch((error) => {
    Logger.error(error, 'BackfillSectionCoordinates');
    process.exitCode = 1;
  });
}
