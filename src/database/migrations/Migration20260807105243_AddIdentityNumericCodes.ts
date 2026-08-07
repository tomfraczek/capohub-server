import { Migration } from '@mikro-orm/migrations';

// Adds a stable, immutable 6-digit numericCode to User and Event (see
// common/utils/numeric-code.ts and the module's own report) - a separate
// namespace/purpose from the existing publicCode column on both tables,
// which is untouched here.
//
// Backfill strategy: nullable column first, then a PL/pgSQL loop assigns
// each existing row a random 6-digit code with a per-row collision retry
// against the codes already committed so far, then the column is set
// NOT NULL and the real constraints are added - see the module spec §13
// ("najpierw nullable, backfill, unique constraint, potem NOT NULL").
// `random()` (not the app's crypto-secure generator) is deliberately used
// here only for this one-time historical backfill of a small number of
// pre-existing dev rows - every new User/Event created from this point
// forward always gets its code from
// common/utils/numeric-code.ts#generateNumericCode (node:crypto randomInt).
export class Migration20260807105243_AddIdentityNumericCodes extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "numeric_code" varchar(6) null;`);
    this.addSql(`
      do $$
      declare
        r record;
        new_code text;
      begin
        for r in select id from "users" where "numeric_code" is null loop
          loop
            new_code := lpad(floor(random() * 1000000)::text, 6, '0');
            exit when not exists (select 1 from "users" where "numeric_code" = new_code);
          end loop;
          update "users" set "numeric_code" = new_code where id = r.id;
        end loop;
      end $$;
    `);
    this.addSql(`alter table "users" alter column "numeric_code" set not null;`);
    this.addSql(`alter table "users" add constraint "users_numeric_code_unique" unique ("numeric_code");`);
    this.addSql(`alter table "users" add constraint users_numeric_code_check check("numeric_code" ~ '^[0-9]{6}$');`);

    this.addSql(`alter table "events" add column "numeric_code" varchar(6) null;`);
    this.addSql(`
      do $$
      declare
        r record;
        new_code text;
      begin
        for r in select id, "type" from "events" where "numeric_code" is null loop
          loop
            new_code := lpad(floor(random() * 1000000)::text, 6, '0');
            exit when not exists (
              select 1 from "events" where "type" = r."type" and "numeric_code" = new_code
            );
          end loop;
          update "events" set "numeric_code" = new_code where id = r.id;
        end loop;
      end $$;
    `);
    this.addSql(`alter table "events" alter column "numeric_code" set not null;`);
    this.addSql(`alter table "events" add constraint "events_type_numeric_code_unique" unique ("type", "numeric_code");`);
    this.addSql(`alter table "events" add constraint events_numeric_code_check check("numeric_code" ~ '^[0-9]{6}$');`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" drop constraint "events_type_numeric_code_unique";`);
    this.addSql(`alter table "events" drop constraint events_numeric_code_check;`);
    this.addSql(`alter table "events" drop column "numeric_code";`);

    this.addSql(`alter table "users" drop constraint "users_numeric_code_unique";`);
    this.addSql(`alter table "users" drop constraint users_numeric_code_check;`);
    this.addSql(`alter table "users" drop column "numeric_code";`);
  }

}
