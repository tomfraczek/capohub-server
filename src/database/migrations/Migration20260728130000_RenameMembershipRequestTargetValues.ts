import { Migration } from '@mikro-orm/migrations';

// Part of the Group/Section domain rename (see the rename ADR):
// MembershipRequestTarget.ORGANIZATION -> GROUP, .GROUP -> SECTION. Unlike
// the Cohort rename (a pure schema rename), this touches real stored row
// values, so a naive two-step UPDATE (ORGANIZATION->GROUP then GROUP->SECTION)
// would corrupt data - the second UPDATE would also match rows the first one
// just wrote. Rotates through a temporary sentinel value instead so each
// UPDATE's WHERE clause only ever matches original, untouched values.
export class Migration20260728130000_RenameMembershipRequestTargetValues extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "membership_requests" drop constraint if exists "membership_requests_target_type_check";`,
    );
    this.addSql(
      `alter table "membership_requests" add constraint "membership_requests_target_type_check" check ("target_type" in ('ORGANIZATION','GROUP','SECTION','__GROUP_TMP__'));`,
    );

    this.addSql(
      `update "membership_requests" set "target_type" = '__GROUP_TMP__' where "target_type" = 'GROUP';`,
    );
    this.addSql(
      `update "membership_requests" set "target_type" = 'SECTION' where "target_type" = '__GROUP_TMP__';`,
    );
    this.addSql(
      `update "membership_requests" set "target_type" = 'GROUP' where "target_type" = 'ORGANIZATION';`,
    );

    this.addSql(
      `alter table "membership_requests" drop constraint if exists "membership_requests_target_type_check";`,
    );
    this.addSql(
      `alter table "membership_requests" add constraint "membership_requests_target_type_check" check ("target_type" in ('GROUP','SECTION'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "membership_requests" drop constraint if exists "membership_requests_target_type_check";`,
    );
    this.addSql(
      `alter table "membership_requests" add constraint "membership_requests_target_type_check" check ("target_type" in ('GROUP','SECTION','ORGANIZATION','__ORGANIZATION_TMP__'));`,
    );

    this.addSql(
      `update "membership_requests" set "target_type" = '__ORGANIZATION_TMP__' where "target_type" = 'GROUP';`,
    );
    this.addSql(
      `update "membership_requests" set "target_type" = 'ORGANIZATION' where "target_type" = '__ORGANIZATION_TMP__';`,
    );
    this.addSql(
      `update "membership_requests" set "target_type" = 'GROUP' where "target_type" = 'SECTION';`,
    );

    this.addSql(
      `alter table "membership_requests" drop constraint if exists "membership_requests_target_type_check";`,
    );
    this.addSql(
      `alter table "membership_requests" add constraint "membership_requests_target_type_check" check ("target_type" in ('ORGANIZATION','GROUP'));`,
    );
  }
}
