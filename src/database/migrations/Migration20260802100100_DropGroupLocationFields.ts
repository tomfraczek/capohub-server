import { Migration } from '@mikro-orm/migrations';

// Stage 1 of the organizational-domain rebuild (part 2 of 3, see
// Migration20260802100000_SplitGroupsAndSections). A Group is an
// organizational container that may span many places (or none); the
// physical-location fields (country/city/region/geoname_id) now live on
// Section only (see group.entity.ts / section.entity.ts) - every row that
// had one of these set *and* moved into `sections` already carries its
// values there (copied verbatim by the previous migration), so nothing is
// lost for a former "Section". Only a row that both (a) stayed a Group
// (root, or a non-root row forced to remain a Group per the previous
// migration's own comment) and (b) had one of these fields populated loses
// it here. As of this migration, that is exactly one row in the current
// database (a root Group with a test address set) - documented in the
// stage-1 migration report; every other Group-typed row already has all
// four fields NULL, so this drops no real data for them.
export class Migration20260802100100_DropGroupLocationFields extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "groups" drop constraint if exists "groups_country_check";`,
    );
    this.addSql(`alter table "groups" drop column "country";`);
    this.addSql(`alter table "groups" drop column "city";`);
    this.addSql(`alter table "groups" drop column "region";`);
    this.addSql(`alter table "groups" drop column "geoname_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" add column "country" varchar(2) null;`);
    this.addSql(`alter table "groups" add column "city" varchar(100) null;`);
    this.addSql(`alter table "groups" add column "region" varchar(100) null;`);
    this.addSql(`alter table "groups" add column "geoname_id" int null;`);
    this.addSql(
      `alter table "groups" add constraint "groups_country_check" check ("country" is null or "country" ~ '^[A-Z]{2}$');`,
    );
    // Values for rows that were already Group-typed when up() ran are not
    // restored (see the class comment) - this reintroduces the columns,
    // not the one root Group's original values.
  }
}
