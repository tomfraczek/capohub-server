import { Migration } from '@mikro-orm/migrations';

export class Migration20260921113315_AddUserClerkHasImage extends Migration {

  override async up(): Promise<void> {
    // Nullable, no default - every pre-existing row starts out as "not
    // synced yet" (null), never a guessed true/false. The next
    // authenticated request from each user resyncs it for real via
    // ClerkAuthGuard -> UserService.findOrCreateFromClerk (runs on every
    // request, not just login) - see the column's own comment on
    // user.entity.ts. Consumers must treat null the same as false.
    this.addSql(`alter table "users" add column "clerk_has_image" boolean null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "clerk_has_image";`);
  }

}
