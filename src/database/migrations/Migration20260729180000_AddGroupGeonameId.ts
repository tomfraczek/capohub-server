import { Migration } from '@mikro-orm/migrations';

// Part of the switch to official GeoNames data as the location source of
// truth (see common/geo/city-directory.ts). Adds `geonameId` to `groups` -
// the GeoNames-assigned, globally stable identifier for the city a
// Group/Section is in, which `country`/`city`/`region` are now cross-
// checked against on every create/update (see
// group-validation.helpers.ts#refineCityIdentification), rather than being
// re-derivable from those free-text fields alone (the exact problem a
// stable id exists to solve).
//
// Nullable at the DB layer, same reasoning as `country`/`city`/`region` in
// the migrations that added them: existing rows predate this field, and
// there is no way to unambiguously match a bare (country, city, region)
// string combination back to one specific real-world GeoNames place after
// the fact (that reconstruction is exactly what was previously
// impossible, and exactly why this migration exists) - so it is never
// backfilled here. Every new write goes through the application-layer
// schema, which requires a real, verified `geonameId` and never lets a row
// be saved without one again - so a legacy row keeps reading back exactly
// as it is (with `geonameId: null`) until its next edit, at which point
// the caller must resolve a real city through GET /discovery/cities, the
// same as creating a brand new Group/Section.
export class Migration20260729180000_AddGroupGeonameId extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "groups" add column "geoname_id" int null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" drop column "geoname_id";`);
  }
}
