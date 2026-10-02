import { Migration } from '@mikro-orm/migrations';

// Adds User.gender (see users/enums/user-gender.enum.ts) - nullable, no
// backfill: every existing user starts as "not set", which the app renders
// with the neutral wording until they choose.
export class Migration20261002140000_AddUserGender extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "gender" text null check ("gender" in ('MALE', 'FEMALE', 'UNDISCLOSED'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "gender";`);
  }

}
