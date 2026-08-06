import { Migration } from '@mikro-orm/migrations';

// Adds the User Profile Stage 1 fields (see user.entity.ts) and the new
// formal_group_affiliations table (see formal-group-affiliation.entity.ts).
// Purely additive - no existing column is altered or dropped, and every new
// `users` column is nullable/defaulted, so the 2 existing dev accounts
// (neither with structured name data) simply get NULL/false for all of
// them. No data reinterpretation, so - like
// Migration20260804150000_AddHierarchyInvitations - this migration has no
// dedicated .itest.ts.
export class Migration20260805100000_AddUserProfileAndFormalGroupAffiliation extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "users"
        add column "first_name" varchar(100) null,
        add column "last_name" varchar(100) null,
        add column "apelido" varchar(100) null,
        add column "city" varchar(100) null,
        add column "country" varchar(2) null,
        add column "capoeira_started_at" date null,
        add column "show_full_name" boolean not null default false,
        add column "show_apelido" boolean not null default false,
        add column "show_location" boolean not null default false,
        add column "show_capoeira_started_at" boolean not null default false,
        add column "show_sections" boolean not null default false,
        add column "show_formal_group" boolean not null default false;
    `);
    // Mirrors sections_country_check (see section.entity.ts).
    this.addSql(`
      alter table "users" add constraint "users_country_check"
        check ("country" is null or "country" ~ '^[A-Z]{2}$');
    `);

    this.addSql(`
      create table "formal_group_affiliations" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "user_id" uuid not null,
        "group_id" uuid not null,
        "started_on" date null,
        "ended_on" date null,
        constraint "formal_group_affiliations_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "formal_group_affiliations_user_id_index" on "formal_group_affiliations" ("user_id");`,
    );
    this.addSql(
      `create index "formal_group_affiliations_group_id_index" on "formal_group_affiliations" ("group_id");`,
    );
    this.addSql(`
      alter table "formal_group_affiliations" add constraint "formal_group_affiliations_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "formal_group_affiliations" add constraint "formal_group_affiliations_group_id_foreign"
        foreign key ("group_id") references "groups" ("id") on update cascade on delete no action;
    `);
    // At most one active (endedOn is null) formal affiliation per user -
    // see FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX.
    this.addSql(`
      create unique index "formal_group_affiliations_user_id_active_unique"
        on "formal_group_affiliations" ("user_id") where ("ended_on" is null);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table "formal_group_affiliations" cascade;`);

    this.addSql(
      `alter table "users" drop constraint "users_country_check";`,
    );
    this.addSql(`
      alter table "users"
        drop column "first_name",
        drop column "last_name",
        drop column "apelido",
        drop column "city",
        drop column "country",
        drop column "capoeira_started_at",
        drop column "show_full_name",
        drop column "show_apelido",
        drop column "show_location",
        drop column "show_capoeira_started_at",
        drop column "show_sections",
        drop column "show_formal_group";
    `);
  }
}
