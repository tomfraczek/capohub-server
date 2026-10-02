import { Migration } from '@mikro-orm/migrations';

// Drops User.showFullName/showApelido - first name, last name and apelido
// are basic identity and no longer have any privacy setting: whatever a
// user stored is always visible. Dropping the columns (rather than leaving
// them unread) guarantees no previously saved "hide" choice can affect the
// API again. `down()` restores both with the original default (true =
// visible) - the users' former choices are not recoverable.
export class Migration20261002100000_DropIdentityPrivacyToggles extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" drop column "show_full_name", drop column "show_apelido";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" add column "show_full_name" boolean not null default true, add column "show_apelido" boolean not null default true;`);
  }

}
