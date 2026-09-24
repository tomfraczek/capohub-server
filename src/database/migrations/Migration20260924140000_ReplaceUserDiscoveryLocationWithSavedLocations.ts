import { Migration } from '@mikro-orm/migrations';

// Replaces the single-row-per-user "user_discovery_locations" (see
// user-discovery-location.entity.ts, now deleted) with "saved_locations" - a
// real one-to-many (see saved-location.entity.ts's own comment on why: a
// user may now have several named places, each with its own search radius,
// switched between client-side rather than the server holding "the" one
// location).
//
// Every existing row is preserved, migrated 1:1 as that user's first
// SavedLocation: `city`/`region`/`country_code`/`latitude`/`longitude`
// carry straight over, `name` starts unset (the old model had no concept of
// a custom label - the frontend falls back to `city`, never a fabricated
// name), `radius_km` gets DEFAULT_NEARBY_RADIUS_KM's value (50, matching
// community-overview.constants.ts, since the old model had no radius at
// all - every nearby query implicitly used that same default).
// `display_name`/`source` are deliberately NOT carried over - display_name
// was already redundant with city/region (the frontend always computed the
// same string itself), and source ('gps'|'manual') stops being meaningful
// once a SavedLocation can only ever be created via the search flow (a live
// GPS reading is never itself persisted - see DeviceLocation's own
// documentation on the frontend).
export class Migration20260924140000_ReplaceUserDiscoveryLocationWithSavedLocations extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table "saved_locations" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "user_id" uuid not null,
        "name" varchar(100) null,
        "city" varchar(100) null,
        "region" varchar(100) null,
        "country_code" varchar(2) null,
        "latitude" real not null,
        "longitude" real not null,
        "radius_km" smallint not null default 50,
        "notifications_enabled" boolean not null default false,
        constraint "saved_locations_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "saved_locations_user_id_index" on "saved_locations" ("user_id");`,
    );
    this.addSql(`
      alter table "saved_locations" add constraint "saved_locations_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);

    this.addSql(`
      insert into "saved_locations"
        ("id", "created_at", "updated_at", "user_id", "name", "city", "region", "country_code", "latitude", "longitude", "radius_km", "notifications_enabled")
      select gen_random_uuid(), "created_at", "updated_at", "user_id", null, "city", "region", "country_code", "latitude", "longitude", 50, false
      from "user_discovery_locations";
    `);

    this.addSql(`drop table "user_discovery_locations" cascade;`);
  }

  // Not a full 1:1 reversal - the forward migration is only ever a clean
  // one-row-per-user copy at the moment it runs. By the time anyone runs
  // down(), a user may have added, renamed, or deleted SavedLocations, and
  // the old model has no room for more than one place per user at all - so
  // this restores each user's OLDEST surviving SavedLocation (the closest
  // available proxy for "the one that used to be there") into the
  // recreated table, and only where it still has the city/countryCode the
  // old schema required NOT NULL (a SavedLocation created since with either
  // left blank has no valid old-model counterpart and is simply skipped).
  // Any additional SavedLocations, and display_name/source (already dropped
  // going forward - see this file's class comment), are not recoverable.
  override async down(): Promise<void> {
    this.addSql(`
      create table "user_discovery_locations" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "user_id" uuid not null,
        "city" varchar(100) not null,
        "region" varchar(100) null,
        "country_code" varchar(2) not null,
        "latitude" real not null,
        "longitude" real not null,
        "display_name" varchar(255) null,
        "source" varchar(50) null,
        constraint "user_discovery_locations_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "user_discovery_locations" add constraint "user_discovery_locations_user_id_unique" unique ("user_id");`,
    );
    this.addSql(`
      alter table "user_discovery_locations" add constraint "user_discovery_locations_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);

    this.addSql(`
      insert into "user_discovery_locations"
        ("id", "created_at", "updated_at", "user_id", "city", "region", "country_code", "latitude", "longitude")
      select distinct on (sl."user_id") gen_random_uuid(), sl."created_at", sl."updated_at", sl."user_id", sl."city", sl."region", sl."country_code", sl."latitude", sl."longitude"
      from "saved_locations" sl
      where sl."city" is not null and sl."country_code" is not null
      order by sl."user_id", sl."created_at" asc;
    `);

    this.addSql(`drop table "saved_locations" cascade;`);
  }

}
