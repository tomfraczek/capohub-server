import { Migration } from '@mikro-orm/migrations';

// Part of the Group/Section domain rename (see the rename ADR). Adds
// `country` (ISO 3166-1 alpha-2, format-checked here; full code-list
// validity is enforced in the application layer - see countryCodeSchema)
// and `city` (free text) to `groups`. Both nullable at the DB layer: no
// safe value exists to backfill onto the ~155 existing rows, so "required"
// is enforced only at the DTO layer for new Group/Section creates (see
// create-group.schema.ts / create-section.schema.ts), never retroactively
// here. No data touched, no existing rows affected beyond gaining two new
// NULL columns.
export class Migration20260728140000_AddGroupCountryAndCity extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "groups" add column "country" varchar(2) null;`);
    this.addSql(`alter table "groups" add column "city" varchar(100) null;`);
    this.addSql(
      `alter table "groups" add constraint "groups_country_check" check ("country" is null or "country" ~ '^[A-Z]{2}$');`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "groups" drop constraint if exists "groups_country_check";`,
    );
    this.addSql(`alter table "groups" drop column "city";`);
    this.addSql(`alter table "groups" drop column "country";`);
  }
}
