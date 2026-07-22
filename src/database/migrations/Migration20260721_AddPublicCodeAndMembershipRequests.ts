import { Migration } from '@mikro-orm/migrations';

// ─── publicCode backfill helper ───────────────────────────────────────────────
//
// Uses the same 32-symbol Crockford-inspired charset as the TypeScript
// generator (src/common/utils/public-code.ts). 256 is an exact multiple of 32
// so `get_byte(...) % 32` distributes uniformly.
//
// Uniqueness guarantee: the backfill loop retries until it finds a code that
// does not already exist in either `users` or `groups`. For real datasets
// (thousands to low-millions of rows) the probability of a retry is
// effectively zero (code space ≈ 1.1 trillion), but the loop is included as
// a correctness guarantee, not just documentation.
const BACKFILL_SQL = `
do $$
declare
  v_charset  constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea;
  v_code     text;
  v_id       uuid;
  v_email    text;
begin
  -- ─── backfill groups ───────────────────────────────────────────
  for v_id in select id from groups where public_code is null loop
    loop
      v_bytes := gen_random_bytes(8);
      v_code  := substr(v_charset, (get_byte(v_bytes,0) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,1) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,2) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,3) % 32)+1, 1)
              || '-'
              || substr(v_charset, (get_byte(v_bytes,4) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,5) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,6) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,7) % 32)+1, 1);
      exit when not exists (select 1 from groups where public_code = v_code)
            and not exists (select 1 from users  where public_code = v_code);
    end loop;
    update groups set public_code = v_code where id = v_id;
  end loop;

  -- ─── backfill users ────────────────────────────────────────────
  for v_id in select id from users where public_code is null loop
    loop
      v_bytes := gen_random_bytes(8);
      v_code  := substr(v_charset, (get_byte(v_bytes,0) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,1) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,2) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,3) % 32)+1, 1)
              || '-'
              || substr(v_charset, (get_byte(v_bytes,4) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,5) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,6) % 32)+1, 1)
              || substr(v_charset, (get_byte(v_bytes,7) % 32)+1, 1);
      exit when not exists (select 1 from groups where public_code = v_code)
            and not exists (select 1 from users  where public_code = v_code);
    end loop;
    update users set public_code = v_code where id = v_id;
  end loop;
end $$;
`;

export class Migration20260721_AddPublicCodeAndMembershipRequests extends Migration {
  override async up(): Promise<void> {
    // ─── 1. publicCode on groups ──────────────────────────────────────────
    // Add nullable first so backfill can run; made NOT NULL after.
    this.addSql(
      `alter table "groups" add column "public_code" varchar(15) null;`,
    );
    // Replace old `visibility` TEXT enum with the two independent booleans.
    // is_public = true matches the historical visibility = 'PUBLIC' default.
    this.addSql(
      `alter table "groups" add column "is_public" boolean not null default true;`,
    );
    this.addSql(
      `alter table "groups" add column "is_hidden" boolean not null default false;`,
    );
    this.addSql(
      `alter table "groups" add column "member_invites_allowed" boolean not null default false;`,
    );
    // Migrate old visibility value to is_public
    this.addSql(
      `update "groups" set "is_public" = (visibility = 'PUBLIC') where visibility is not null;`,
    );
    // Drop the old visibility column
    this.addSql(
      `alter table "groups" drop constraint if exists "groups_visibility_check";`,
    );
    this.addSql(`alter table "groups" drop column if exists "visibility";`);

    // ─── 2. publicCode on users ───────────────────────────────────────────
    this.addSql(
      `alter table "users" add column "public_code" varchar(15) null;`,
    );

    // ─── 3. Backfill both tables with unique codes ────────────────────────
    this.addSql(BACKFILL_SQL);

    // ─── 4. Make publicCode NOT NULL and add UNIQUE constraints ───────────
    this.addSql(
      `alter table "groups" alter column "public_code" set not null;`,
    );
    this.addSql(
      `alter table "users"  alter column "public_code" set not null;`,
    );
    this.addSql(
      `alter table "groups" add constraint "groups_public_code_unique" unique ("public_code");`,
    );
    this.addSql(
      `alter table "users"  add constraint "users_public_code_unique"  unique ("public_code");`,
    );

    // Verification: every row must have a code after backfill.
    this.addSql(`
      do $$
      declare
        g_missing integer;
        u_missing integer;
      begin
        select count(*) into g_missing from groups where public_code is null;
        select count(*) into u_missing from users  where public_code is null;
        if g_missing > 0 then
          raise exception 'Migration: % group(s) have no public_code after backfill', g_missing;
        end if;
        if u_missing > 0 then
          raise exception 'Migration: % user(s) have no public_code after backfill',  u_missing;
        end if;
      end $$;
    `);

    // ─── 5. membership_requests table ─────────────────────────────────────
    this.addSql(`
      create table "membership_requests" (
        "id"              uuid         not null,
        "created_at"      timestamptz  not null,
        "updated_at"      timestamptz  not null,
        "type"            text         check ("type" in ('INVITATION','JOIN_REQUEST')) not null,
        "target_type"     text         check ("target_type" in ('ORGANIZATION','GROUP')) not null,
        "target_group_id" uuid         not null,
        "initiated_by_id" uuid         not null,
        "invited_user_id" uuid         null,
        "invited_email"   varchar(255) null,
        "status"          text         check ("status" in ('PENDING','ACCEPTED','REJECTED','CANCELLED')) not null default 'PENDING',
        "processed_at"    timestamptz  null,
        "processed_by_id" uuid         null,
        constraint "membership_requests_pkey" primary key ("id")
      );
    `);

    // Standard column indexes
    this.addSql(
      `create index "membership_requests_target_group_id_index"  on "membership_requests" ("target_group_id");`,
    );
    this.addSql(
      `create index "membership_requests_initiated_by_id_index" on "membership_requests" ("initiated_by_id");`,
    );
    this.addSql(
      `create index "membership_requests_invited_user_id_index"  on "membership_requests" ("invited_user_id");`,
    );
    this.addSql(
      `create index "membership_requests_invited_email_index"    on "membership_requests" ("invited_email");`,
    );

    // Partial unique indexes (one PENDING per recipient per target)
    this.addSql(`
      create unique index "membership_requests_pending_user_invitation_unique"
        on "membership_requests" ("target_group_id", "invited_user_id")
        where ("status" = 'PENDING' and "type" = 'INVITATION' and "invited_user_id" is not null);
    `);
    this.addSql(`
      create unique index "membership_requests_pending_email_invitation_unique"
        on "membership_requests" ("target_group_id", "invited_email")
        where ("status" = 'PENDING' and "type" = 'INVITATION' and "invited_email" is not null);
    `);
    this.addSql(`
      create unique index "membership_requests_pending_join_request_unique"
        on "membership_requests" ("target_group_id", "initiated_by_id")
        where ("status" = 'PENDING' and "type" = 'JOIN_REQUEST');
    `);

    // Foreign keys - no cascade: Groups/Users are soft-deleted (ADR-007)
    this.addSql(`
      alter table "membership_requests"
        add constraint "membership_requests_target_group_id_foreign"
        foreign key ("target_group_id") references "groups" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "membership_requests"
        add constraint "membership_requests_initiated_by_id_foreign"
        foreign key ("initiated_by_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "membership_requests"
        add constraint "membership_requests_invited_user_id_foreign"
        foreign key ("invited_user_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "membership_requests"
        add constraint "membership_requests_processed_by_id_foreign"
        foreign key ("processed_by_id") references "users" ("id") on update cascade;
    `);
  }

  override async down(): Promise<void> {
    // ─── Reverse: membership_requests ─────────────────────────────────────
    this.addSql(`drop table if exists "membership_requests" cascade;`);

    // ─── Reverse: publicCode columns ──────────────────────────────────────
    this.addSql(
      `alter table "groups" drop constraint if exists "groups_public_code_unique";`,
    );
    this.addSql(
      `alter table "users"  drop constraint if exists "users_public_code_unique";`,
    );
    this.addSql(`alter table "groups" drop column if exists "public_code";`);
    this.addSql(`alter table "users"  drop column if exists "public_code";`);

    // ─── Reverse: group settings columns ──────────────────────────────────
    this.addSql(
      `alter table "groups" drop column if exists "member_invites_allowed";`,
    );
    this.addSql(`alter table "groups" drop column if exists "is_hidden";`);
    // Restore visibility enum
    this.addSql(
      `alter table "groups" add column "visibility" text check ("visibility" in ('PUBLIC','PRIVATE')) not null default 'PUBLIC';`,
    );
    this.addSql(
      `update "groups" set "visibility" = case when "is_public" = true then 'PUBLIC' else 'PRIVATE' end;`,
    );
    this.addSql(`alter table "groups" drop column if exists "is_public";`);
  }
}
