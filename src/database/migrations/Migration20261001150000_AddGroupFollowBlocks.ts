import { Migration } from '@mikro-orm/migrations';

// "group_follow_blocks" - GroupFollowBlock (see
// groups/entities/group-follow-block.entity.ts): a Group OWNER/ADMIN's
// block on a user following that Group. Same shape and FK rules as
// "group_follows".
export class Migration20261001150000_AddGroupFollowBlocks extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "group_follow_blocks" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "group_id" uuid not null, constraint "group_follow_blocks_pkey" primary key ("id"));`);
    this.addSql(`create index "group_follow_blocks_user_id_index" on "group_follow_blocks" ("user_id");`);
    this.addSql(`create index "group_follow_blocks_group_id_index" on "group_follow_blocks" ("group_id");`);
    this.addSql(`alter table "group_follow_blocks" add constraint "group_follow_blocks_user_id_group_id_unique" unique ("user_id", "group_id");`);

    this.addSql(`alter table "group_follow_blocks" add constraint "group_follow_blocks_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "group_follow_blocks" add constraint "group_follow_blocks_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade on delete no action;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "group_follow_blocks" cascade;`);
  }

}
