import { Migration } from '@mikro-orm/migrations';

// Adds User.displayNameMode (see users/enums/display-name-mode.enum.ts).
// NOT NULL with a FULL_NAME default, so every existing account keeps
// exactly the name it was shown with before ("Imię Nazwisko") until its
// owner opts into TITLE_APELIDO. Only the preference is stored - the rank
// title it may combine with is always read live (User.currentRankTitle).
export class Migration20261009100000_AddUserDisplayNameMode extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "display_name_mode" text not null default 'FULL_NAME' check ("display_name_mode" in ('FULL_NAME', 'TITLE_APELIDO'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "display_name_mode";`);
  }

}
