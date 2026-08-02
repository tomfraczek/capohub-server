import { Migration } from '@mikro-orm/migrations';

// Stage 1 of the organizational-domain rebuild: physically splits the
// single `groups` table (self-referencing "root = Group, non-root =
// Section" table) into two genuinely separate tables, `groups` and
// `sections`, matching the new Group/Section entity split (see
// group.entity.ts / section.entity.ts).
//
// Existing data is interpreted strictly by the *old* model's own rule -
// the only rule that ever actually existed - never guessed from
// name/city/member-count/usage, and never adjusted for what the new model
// additionally requires:
//   - a row with parent_group_id IS NULL was, and remains, a Group.
//   - a row with parent_group_id IS NOT NULL was a Section under the old
//     model, full stop - whether or not it happens to have children of its
//     own. The old model had no such restriction, so "has children" was
//     never part of how a row's type was determined and must not become a
//     silent type-classification heuristic now.
//
// The new model additionally forbids a Section from having children (see
// section.entity.ts) - a genuine structural conflict for any row that was
// a Section under the old rule (parent_group_id IS NOT NULL) but has its
// own children in `groups`. This migration does not resolve that conflict
// by guessing: it refuses to run at all while such a row exists (see the
// guard immediately below), rather than silently keeping it as a Group
// (which would be an undocumented, unrequested type change) or deleting
// it. Resolving that conflict - by re-parenting the children, deleting
// dev-only data, or some other explicit decision - is a prerequisite this
// migration enforces, not something it performs itself.
//
// IDs, timestamps and every other column value are preserved unchanged for
// every row that moves - this is a re-typing of existing rows, not a
// re-creation of them.
export class Migration20260802100000_SplitGroupsAndSections extends Migration {
  override async up(): Promise<void> {
    // Hard stop, not a heuristic: if any row that the old model's own rule
    // classifies as a Section (parent_group_id IS NOT NULL) itself has
    // children, this migration cannot proceed without either silently
    // changing that row's type (forbidden - see class comment) or deleting
    // data (never done automatically). Every blocking row is named
    // explicitly so the operator can resolve it by hand and re-run.
    this.addSql(`
      do $$
      declare
        blocked text;
      begin
        select string_agg(
          format(
            'id=%s name=%s parent_group_id=%s child_ids=%s',
            g.id,
            g.name,
            g.parent_group_id,
            (select string_agg(c.id::text, ', ') from "groups" c where c.parent_group_id = g.id)
          ),
          e'\\n'
        )
        into blocked
        from "groups" g
        where g.parent_group_id is not null
          and exists (select 1 from "groups" c where c.parent_group_id = g.id);

        if blocked is not null then
          raise exception e'Migration20260802100000_SplitGroupsAndSections: cannot classify the following row(s) - each has parent_group_id IS NOT NULL (a Section under the old model''s own rule) but also has its own children, which the new model forbids for Section. This migration will not silently keep such a row as Group and will not delete anything automatically. Resolve manually (re-parent its children, or remove this row if it is disposable dev/test data) and re-run the migration.\\n%', blocked;
        end if;
      end $$;
    `);

    this.addSql(`
      create table "sections" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "parent_group_id" uuid null,
        "name" varchar(150) not null,
        "description" text null,
        "logo_url" varchar(2048) null,
        "cover_image_url" varchar(2048) null,
        "contact_email" varchar(255) null,
        "contact_phone" varchar(50) null,
        "website_url" varchar(2048) null,
        "facebook_url" varchar(2048) null,
        "instagram_url" varchar(2048) null,
        "youtube_url" varchar(2048) null,
        "country" varchar(2) null,
        "city" varchar(100) null,
        "region" varchar(100) null,
        "geoname_id" int null,
        "is_public" boolean not null default true,
        "is_hidden" boolean not null default false,
        "member_invites_allowed" boolean not null default false,
        "public_code" varchar(15) null,
        "status" text check ("status" in ('ACTIVE', 'READ_ONLY', 'ARCHIVED', 'DELETED')) not null default 'ACTIVE',
        "timezone" varchar(100) not null,
        "currency_code" varchar(3) not null,
        constraint "sections_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "sections" add constraint "sections_country_check" check ("country" is null or "country" ~ '^[A-Z]{2}$');`,
    );
    this.addSql(
      `alter table "sections" add constraint "sections_public_code_unique" unique ("public_code");`,
    );
    this.addSql(
      `create index "sections_parent_group_id_index" on "sections" ("parent_group_id");`,
    );
    this.addSql(
      `create index "sections_status_index" on "sections" ("status");`,
    );
    this.addSql(`
      alter table "sections" add constraint "sections_parent_group_id_foreign"
        foreign key ("parent_group_id") references "groups" ("id") on update cascade on delete no action;
    `);

    // Move every non-root row into `sections`, preserving
    // id/timestamps/every column value verbatim - the guard above already
    // guarantees none of them have children of their own, so this is the
    // old model's own rule (parent_group_id IS NOT NULL) applied
    // unconditionally, with no further filtering.
    this.addSql(`
      insert into "sections"
        ("id", "created_at", "updated_at", "parent_group_id", "name", "description",
         "logo_url", "cover_image_url", "contact_email", "contact_phone", "website_url",
         "facebook_url", "instagram_url", "youtube_url", "country", "city", "region",
         "geoname_id", "is_public", "is_hidden", "member_invites_allowed", "public_code",
         "status", "timezone", "currency_code")
      select
        "id", "created_at", "updated_at", "parent_group_id", "name", "description",
        "logo_url", "cover_image_url", "contact_email", "contact_phone", "website_url",
        "facebook_url", "instagram_url", "youtube_url", "country", "city", "region",
        "geoname_id", "is_public", "is_hidden", "member_invites_allowed", "public_code",
        "status", "timezone", "currency_code"
      from "groups" g
      where g."parent_group_id" is not null;
    `);

    // Every FK across the schema that referenced these rows while they
    // lived in `groups` is repointed in Migration20260802100200 (the
    // dependent-module polymorphic-reference migration), once the new
    // *_section_id columns it adds exist. Deleting the moved rows out of
    // `groups` happens last, in that same migration, only after every
    // dependent FK has been repointed - see its own comment for why this
    // must stay a single, later transaction rather than happening here.
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sections" cascade;`);
  }
}
