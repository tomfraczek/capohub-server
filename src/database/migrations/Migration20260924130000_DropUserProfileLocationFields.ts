import { Migration } from '@mikro-orm/migrations';

// Drops User.city/User.country (the old "Edytuj profil" location fields,
// added by Migration20260805100000_AddUserProfileAndFormalGroupAffiliation)
// and User.showLocation, the privacy toggle that used to gate them - the
// profile edit form no longer collects a location at all, so this column
// trio had become write-only dead weight the moment the form field was
// removed (see privacy.tsx's own "don't create a setting for a field the
// backend doesn't have" convention - keeping showLocation around with
// nothing left to gate would violate it). Location data now lives
// exclusively in UserDiscoveryLocation (user_discovery_locations table, see
// user-discovery-location.entity.ts) - a deliberately separate, private-
// only mechanism this migration does not touch.
export class Migration20260924130000_DropUserProfileLocationFields extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" drop constraint "users_country_check";`);
    this.addSql(`alter table "users" drop column "city", drop column "country", drop column "show_location";`);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "users"
        add column "city" varchar(100) null,
        add column "country" varchar(2) null,
        add column "show_location" boolean not null default true;
    `);
    this.addSql(
      `alter table "users" add constraint "users_country_check" check ("country" is null or "country" ~ '^[A-Z]{2}$');`,
    );
  }

}
