import { Migration } from '@mikro-orm/migrations';

// Community discovery/observing (see this feature's own report):
//  - "group_follows" - GroupFollow (see groups/entities/group-follow.entity.ts):
//    a User observing a Group with no membership/role granted at all.
//  - "user_discovery_locations" - UserDiscoveryLocation (see
//    users/entities/user-discovery-location.entity.ts): a User's own,
//    privately-held nearby-discovery location - never the public-profile
//    city/country field on `users` (unaffected here).
//  - "sections.latitude"/"sections.longitude" - precise venue coordinates
//    nearby discovery ranks against (same nullable-float shape as
//    Academy/Event's own latitude/longitude), plus a composite index
//    backing the bounding-box pre-filter CommunityOverviewService's nearby
//    queries run (see common/geo/distance.ts).
//  - "notifications_type_check" - widened to add EVENT_PUBLISHED (see
//    EventNotificationsService.notifyPublished / NotificationType).
export class Migration20260907132236_AddCommunityFollowLocationDiscovery extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "group_follows" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "group_id" uuid not null, constraint "group_follows_pkey" primary key ("id"));`);
    this.addSql(`create index "group_follows_user_id_index" on "group_follows" ("user_id");`);
    this.addSql(`create index "group_follows_group_id_index" on "group_follows" ("group_id");`);
    this.addSql(`alter table "group_follows" add constraint "group_follows_user_id_group_id_unique" unique ("user_id", "group_id");`);

    this.addSql(`create table "user_discovery_locations" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "city" varchar(100) not null, "region" varchar(100) null, "country_code" varchar(2) not null, "latitude" real not null, "longitude" real not null, "display_name" varchar(255) null, "source" varchar(50) null, constraint "user_discovery_locations_pkey" primary key ("id"));`);
    this.addSql(`alter table "user_discovery_locations" add constraint "user_discovery_locations_user_id_unique" unique ("user_id");`);

    this.addSql(`alter table "group_follows" add constraint "group_follows_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "group_follows" add constraint "group_follows_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "user_discovery_locations" add constraint "user_discovery_locations_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "notifications" drop constraint if exists "notifications_type_check";`);

    this.addSql(`alter table "sections" add column "latitude" real null, add column "longitude" real null;`);
    this.addSql(`create index "sections_latitude_longitude_index" on "sections" ("latitude", "longitude");`);

    this.addSql(`alter table "notifications" add constraint "notifications_type_check" check("type" in ('TRAINING_CANCELLED', 'TRAINING_TIME_CHANGED', 'TRAINING_LOCATION_CHANGED', 'TRAINING_TRAINER_CHANGED', 'TRAINING_REMINDER_24H', 'TRAINING_REMINDER_2H', 'EVENT_INVITATION', 'EVENT_PUBLISHED', 'EVENT_CANCELLED', 'EVENT_TIME_CHANGED', 'EVENT_LOCATION_CHANGED', 'EVENT_REMINDER_24H', 'EVENT_REMINDER_2H', 'ANNOUNCEMENT_PUBLISHED', 'IMPORTANT_ANNOUNCEMENT_PUBLISHED', 'SECTION_JOIN_REQUEST_RECEIVED', 'SECTION_JOIN_REQUEST_APPROVED', 'SECTION_JOIN_REQUEST_REJECTED', 'SECTION_INVITATION_RECEIVED', 'SECTION_INVITATION_ACCEPTED', 'SECTION_INVITATION_REJECTED', 'HIERARCHY_INVITATION_RECEIVED', 'HIERARCHY_INVITATION_ACCEPTED', 'HIERARCHY_INVITATION_REJECTED', 'FORMAL_RANK_CORRECTION_REQUIRED', 'FORMAL_RANK_CORRECTION_SUBMITTED', 'FORMAL_RANK_CORRECTION_APPROVED', 'FORMAL_RANK_CORRECTION_REJECTED'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "group_follows" cascade;`);

    this.addSql(`drop table if exists "user_discovery_locations" cascade;`);

    this.addSql(`alter table "notifications" drop constraint if exists "notifications_type_check";`);

    this.addSql(`alter table "notifications" add constraint "notifications_type_check" check("type" in ('TRAINING_CANCELLED', 'TRAINING_TIME_CHANGED', 'TRAINING_LOCATION_CHANGED', 'TRAINING_TRAINER_CHANGED', 'TRAINING_REMINDER_24H', 'TRAINING_REMINDER_2H', 'EVENT_INVITATION', 'EVENT_CANCELLED', 'EVENT_TIME_CHANGED', 'EVENT_LOCATION_CHANGED', 'EVENT_REMINDER_24H', 'EVENT_REMINDER_2H', 'ANNOUNCEMENT_PUBLISHED', 'IMPORTANT_ANNOUNCEMENT_PUBLISHED', 'SECTION_JOIN_REQUEST_RECEIVED', 'SECTION_JOIN_REQUEST_APPROVED', 'SECTION_JOIN_REQUEST_REJECTED', 'SECTION_INVITATION_RECEIVED', 'SECTION_INVITATION_ACCEPTED', 'SECTION_INVITATION_REJECTED', 'HIERARCHY_INVITATION_RECEIVED', 'HIERARCHY_INVITATION_ACCEPTED', 'HIERARCHY_INVITATION_REJECTED', 'FORMAL_RANK_CORRECTION_REQUIRED', 'FORMAL_RANK_CORRECTION_SUBMITTED', 'FORMAL_RANK_CORRECTION_APPROVED', 'FORMAL_RANK_CORRECTION_REJECTED'));`);

    this.addSql(`drop index "sections_latitude_longitude_index";`);
    this.addSql(`alter table "sections" drop column "latitude", drop column "longitude";`);
  }

}
