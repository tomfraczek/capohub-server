import { Migration } from '@mikro-orm/migrations';

// Makes Training.trainer/TrainingSeries.defaultTrainer nullable (module:
// "prowadzący opcjonalny, czyli jeśli nie zaznaczony to nie pokazuje w
// szczegółach treningu kto prowadzi, a nie że ja prowadzę") - supersedes
// the earlier "no one picked -> the creator becomes the trainer" fallback
// (TrainingsService.create/TrainingSeriesService.create no longer do that):
// an unpicked trainer is now a real `null`, shown as "no trainer assigned"
// rather than silently attributed to whoever created the Training.
export class Migration20260911130000_MakeTrainingTrainerOptional extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "trainings" alter column "trainer_id" drop not null;`);
    this.addSql(`alter table "training_series" alter column "default_trainer_id" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "trainings" alter column "trainer_id" set not null;`);
    this.addSql(`alter table "training_series" alter column "default_trainer_id" set not null;`);
  }

}
