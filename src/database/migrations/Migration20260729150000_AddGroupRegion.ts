import { Migration } from '@mikro-orm/migrations';

// Adds `region` (free text - the admin1 region name, e.g. "Mazovia") to
// `groups`, disambiguating `city` when its name alone is not unique within
// `country` (e.g. two different Polish towns both named "Piaski", in
// different regions - see group-validation.helpers.ts#refineCityIdentification
// and the city-identification analysis behind this migration). Nullable at
// the DB layer, same reasoning as `country`/`city` in
// Migration20260728140000_AddGroupCountryAndCity: existing rows predate
// this field and there is no value to safely, unambiguously backfill onto
// them (which specific same-named city a legacy row's `city` string
// referred to is not recoverable after the fact) - so it stays required
// only at the application layer, for new Group/Section creates and edits,
// never retroactively here. No data touched, no existing rows affected
// beyond gaining one new NULL column.
export class Migration20260729150000_AddGroupRegion extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "groups" add column "region" varchar(100) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" drop column "region";`);
  }
}
