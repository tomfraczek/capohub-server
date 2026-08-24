import { Migration } from '@mikro-orm/migrations';

// "Event Organizer: USER | GROUP | SECTION" module. Events already had
// exactly one of two mutually-exclusive Community references
// (community_group_id/community_section_id - see
// Migration20260802100200_AddPolymorphicCommunityReferences); this adds a
// third, equally-exclusive option so an Event's public organizer identity
// can be a User directly, with no Group/Section involved at all (see
// events/event-community.util.ts and event.entity.ts's own comment).
//
// No backfill: every existing Event already satisfies the old two-way
// check (exactly one of community_group_id/community_section_id set,
// organizer_user_id necessarily null on a freshly added column), which is
// simply a subset of the new three-way check below - no existing row needs
// to change to remain valid.
export class Migration20260821123136_AddEventOrganizerUser extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "events" drop constraint "events_community_group_or_section_check";`);

    this.addSql(`alter table "events" add column "organizer_user_id" uuid null;`);
    this.addSql(`create index "events_organizer_user_id_index" on "events" ("organizer_user_id");`);
    this.addSql(`
      alter table "events" add constraint "events_organizer_user_id_foreign"
        foreign key ("organizer_user_id") references "users" ("id") on update cascade on delete no action;
    `);

    this.addSql(`
      alter table "events" add constraint "events_organizer_check"
        check (
          ("community_group_id" is not null and "community_section_id" is null and "organizer_user_id" is null)
          or ("community_group_id" is null and "community_section_id" is not null and "organizer_user_id" is null)
          or ("community_group_id" is null and "community_section_id" is null and "organizer_user_id" is not null)
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" drop constraint "events_organizer_check";`);

    this.addSql(`alter table "events" drop constraint "events_organizer_user_id_foreign";`);
    this.addSql(`drop index "events_organizer_user_id_index";`);
    this.addSql(`alter table "events" drop column "organizer_user_id";`);

    this.addSql(`
      alter table "events" add constraint "events_community_group_or_section_check"
        check (("community_group_id" is not null and "community_section_id" is null) or ("community_group_id" is null and "community_section_id" is not null));
    `);
  }
}
