import { Migration } from '@mikro-orm/migrations';

// Adds Rank.nameFemale (see graduation/rank-name.util.ts) - nullable, no
// backfill: every existing rank keeps its `name` as the masculine/default
// form and shows it to everyone until the Group fills the feminine one in
// (the create/update schema requires it, so the next edit does).
export class Migration20261015120000_AddRankNameFemale extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "ranks" add column "name_female" varchar(150) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "ranks" drop column "name_female";`);
  }

}
