import { Migration } from '@mikro-orm/migrations';

// Removes Training.latitude/longitude and TrainingSeries.latitude/longitude
// entirely (module: "szerokość i długość geograficzna nie są potrzebne w
// formularzu... usuń z frontendu i backendu jeśli jest tam dodane") - the
// exact same reasoning as Migration20260909105027_DropEventCoordinates:
// nothing in this codebase ever queried/sorted Trainings by distance or
// coordinates, so these columns only ever mirrored whatever a client
// happened to type into a pair of raw number fields. locationName/
// locationAddress (plain text) stay untouched on both tables.
export class Migration20260911120000_DropTrainingCoordinates extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "trainings" drop column "latitude", drop column "longitude";`);
    this.addSql(`alter table "training_series" drop column "latitude", drop column "longitude";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "trainings" add column "latitude" float4 null, add column "longitude" float4 null;`);
    this.addSql(`alter table "training_series" add column "latitude" float4 null, add column "longitude" float4 null;`);
  }

}
