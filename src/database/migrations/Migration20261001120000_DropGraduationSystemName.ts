import { Migration } from '@mikro-orm/migrations';

// Drops GraduationSystem.name - a Group has exactly one graduation catalog,
// so a separate system name only duplicated the Group's own identity and
// was never shown anywhere outside the (now removed) rename flow. No data
// anything still reads is lost. `down()` restores the column with an empty
// default for existing rows (the original values are not recoverable).
export class Migration20261001120000_DropGraduationSystemName extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "graduation_systems" drop column "name";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "graduation_systems" add column "name" varchar(150) not null default '';`);
    this.addSql(`alter table "graduation_systems" alter column "name" drop default;`);
  }

}
