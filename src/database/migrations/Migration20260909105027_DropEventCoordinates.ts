import { Migration } from '@mikro-orm/migrations';

// Removes Event.latitude/longitude entirely (module: "szerokość i długość
// geograficzna nie jest potrzebna, usuń to z frontendu i backendu") -
// nothing in this codebase ever queried/sorted Events by distance or
// coordinates (unlike Section, which genuinely needs them for
// nearby-discovery - see backfill-section-coordinates.ts), so these two
// columns only ever mirrored whatever a client happened to type into a
// pair of raw number fields. locationName/locationAddress (plain text)
// stay untouched.
export class Migration20260909105027_DropEventCoordinates extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "events" drop column "latitude", drop column "longitude";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" add column "latitude" float4 null, add column "longitude" float4 null;`);
  }

}
