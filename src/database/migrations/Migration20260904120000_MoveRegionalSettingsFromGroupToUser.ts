import { Migration } from '@mikro-orm/migrations';

// Moves timezone/currencyCode off Group and onto User (module: "ustawienia
// regionalne z poziomu ustawień profilu" - they are now set once per-User,
// from PATCH /users/me, never at Group create/update time - see
// group.entity.ts's and user.entity.ts's own comments). Section keeps its
// own timezone/currencyCode untouched - this only affects Group.
//
// users.timezone/currency_code are backfilled with the same defaults the
// entity declares ('Europe/Warsaw'/'PLN') for every pre-existing account -
// there is no reliable per-user source to derive a real value from at
// migration time, same reasoning as firstName/lastName's own nullable
// backfill-less introduction (see user.entity.ts).
export class Migration20260904120000_MoveRegionalSettingsFromGroupToUser extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "timezone" varchar(100) not null default 'Europe/Warsaw', add column "currency_code" varchar(3) not null default 'PLN';`);

    this.addSql(`alter table "groups" drop column "timezone", drop column "currency_code";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" add column "timezone" varchar(100) not null default 'Europe/Warsaw', add column "currency_code" varchar(3) not null default 'PLN';`);

    this.addSql(`alter table "users" drop column "timezone", drop column "currency_code";`);
  }

}
