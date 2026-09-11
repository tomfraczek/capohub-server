import { Migration } from '@mikro-orm/migrations';

// Drops Training.allowExternalRsvp/TrainingSeries.allowExternalRsvp (module:
// "bez sensu to trochę, bo skoro publiczna to mogą się zapisywać osoby
// spoza sekcji" - a separate opt-in on top of PUBLIC visibility was
// redundant and confusing: a non-member could already only ever RSVP when
// the Training/Series was PUBLIC, so PUBLIC alone is now sufficient (see
// TrainingAccessService.canRsvp, which no longer reads this column at
// all).
export class Migration20260911140000_DropTrainingAllowExternalRsvp extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "trainings" drop column "allow_external_rsvp";`);
    this.addSql(`alter table "training_series" drop column "allow_external_rsvp";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "trainings" add column "allow_external_rsvp" boolean not null default false;`);
    this.addSql(`alter table "training_series" add column "allow_external_rsvp" boolean not null default false;`);
  }

}
