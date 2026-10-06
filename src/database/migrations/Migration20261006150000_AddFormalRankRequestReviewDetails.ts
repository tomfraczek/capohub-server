import { Migration } from '@mikro-orm/migrations';

// FormalRankRequest review details (see formal-rank-request.entity.ts):
// the rank a reviewer actually confirmed when it differs from the one asked
// for, and an optional rejection reason. Both nullable, no backfill.
export class Migration20261006150000_AddFormalRankRequestReviewDetails extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "formal_rank_requests" add column "approved_rank_id" uuid null, add column "rejection_reason" text null;`);
    this.addSql(`alter table "formal_rank_requests" add constraint "formal_rank_requests_approved_rank_id_foreign" foreign key ("approved_rank_id") references "ranks" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "formal_rank_requests" drop constraint "formal_rank_requests_approved_rank_id_foreign";`);
    this.addSql(`alter table "formal_rank_requests" drop column "approved_rank_id", drop column "rejection_reason";`);
  }

}
