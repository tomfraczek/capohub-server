import { Migration } from '@mikro-orm/migrations';

// Drops SavedLocation.radiusKm - a saved location now only answers "where",
// never "how far": the search radius is a per-search filter chosen on the
// mobile "Odkryj sekcje" picker and sent as `?radiusKm=` on GET
// /community/home and /community/{sections,groups}/nearby, never a property
// of the place itself. No data is lost that anything read: no nearby/home
// query ever used this column (both only ever took the radius from the
// request, defaulting to DEFAULT_NEARBY_RADIUS_KM), it was display-only on
// the client. `down()` restores it with the same 50km default every
// existing row had been created with.
export class Migration20260928120000_DropSavedLocationRadius extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "saved_locations" drop column "radius_km";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "saved_locations" add column "radius_km" smallint not null default 50;`);
  }

}
