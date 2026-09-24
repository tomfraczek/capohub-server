import { Migration } from '@mikro-orm/migrations';

// Flips the column default for the nine profile-privacy toggles from false
// to true, so a freshly created profile now shows every field until the
// owner explicitly opts one out (see the updated comment on User in
// user.entity.ts). Existing users' rows are left untouched - this only
// changes what new rows get, it does not rewrite anyone's current choice.
export class Migration20260924120000_DefaultUserProfilePrivacyToVisible extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" alter column "show_full_name" set default true;`);
    this.addSql(`alter table "users" alter column "show_apelido" set default true;`);
    this.addSql(`alter table "users" alter column "show_location" set default true;`);
    this.addSql(`alter table "users" alter column "show_capoeira_started_at" set default true;`);
    this.addSql(`alter table "users" alter column "show_sections" set default true;`);
    this.addSql(`alter table "users" alter column "show_formal_group" set default true;`);
    this.addSql(`alter table "users" alter column "show_formal_rank" set default true;`);
    this.addSql(`alter table "users" alter column "show_career_timeline" set default true;`);
    this.addSql(`alter table "users" alter column "show_event_participation" set default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" alter column "show_full_name" set default false;`);
    this.addSql(`alter table "users" alter column "show_apelido" set default false;`);
    this.addSql(`alter table "users" alter column "show_location" set default false;`);
    this.addSql(`alter table "users" alter column "show_capoeira_started_at" set default false;`);
    this.addSql(`alter table "users" alter column "show_sections" set default false;`);
    this.addSql(`alter table "users" alter column "show_formal_group" set default false;`);
    this.addSql(`alter table "users" alter column "show_formal_rank" set default false;`);
    this.addSql(`alter table "users" alter column "show_career_timeline" set default false;`);
    this.addSql(`alter table "users" alter column "show_event_participation" set default false;`);
  }

}
