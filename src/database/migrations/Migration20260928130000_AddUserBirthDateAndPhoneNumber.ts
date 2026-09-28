import { Migration } from '@mikro-orm/migrations';

// Adds the two private personal-data fields edited on the mobile "Dane
// osobowe" screen (see User.birthDate/phoneNumber). Both nullable with no
// default - no existing account has a value to backfill.
export class Migration20260928130000_AddUserBirthDateAndPhoneNumber extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "birth_date" date null, add column "phone_number" varchar(32) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "birth_date", drop column "phone_number";`);
  }

}
