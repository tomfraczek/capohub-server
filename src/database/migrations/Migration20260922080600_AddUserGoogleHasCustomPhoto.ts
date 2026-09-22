import { Migration } from '@mikro-orm/migrations';

export class Migration20260922080600_AddUserGoogleHasCustomPhoto extends Migration {

  override async up(): Promise<void> {
    // Nullable, no default - every pre-existing row starts out as "not
    // checked yet" (null), never a guessed true/false, and this migration
    // deliberately does not backfill it via the Google People API (a
    // migration must not make external network calls). The next
    // account-creation, PUT /users/me/avatar/clerk, or DELETE
    // /users/me/profile-image Clerk-fallback resyncs it for real (see
    // UserService.syncGoogleHasCustomPhoto and the column's own comment on
    // user.entity.ts). Consumers must treat null the same as false.
    this.addSql(`alter table "users" add column "google_has_custom_photo" boolean null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "google_has_custom_photo";`);
  }

}
