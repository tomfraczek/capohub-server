import { Migration } from '@mikro-orm/migrations';

// Backfills the OWNER -> formal membership invariant (see
// groups/owner-formal-group.ts) for Groups created before it was enforced:
// every live (ACTIVE/READ_ONLY) Group's active OWNER gets an active
// FormalGroupAffiliation to that Group.
//
// Only the unambiguous, purely additive case is written - an owner who
// (a) has NO active formal affiliation at all and (b) owns exactly ONE
// live Group. Nothing is ever ended, moved or deleted here. Skipped on
// purpose:
//  - an owner already formally affiliated with ANOTHER Group - left as is
//    rather than choosing on the user's behalf;
//  - an owner of more than one live Group - not a valid production state
//    (a user may own at most one live Group); it only exists in e2e
//    fixtures that need it for hierarchy tests (see
//    test/fresh-group-owner.helper.ts's forceGroupOwnerForFixture), so
//    there is nothing to repair.
// The services keep refusing to create either shape (see
// assertNotLeavingOwnedGroup / getOwnershipTransferBlocker / userOwnsGroup).
//
// Idempotent: re-running inserts nothing new (the "no active affiliation"
// filter), and the partial unique index
// formal_group_affiliations_user_id_active_unique backstops it.
export class Migration20261002160000_BackfillOwnerFormalGroup extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      with live_owners as (
        select ra.user_id, ra.group_id
        from role_assignments ra
        join groups g on g.id = ra.group_id
        where ra.role = 'OWNER'
          and ra.revoked_at is null
          and ra.group_id is not null
          and g.status in ('ACTIVE', 'READ_ONLY')
      ),
      single_owners as (
        select user_id, min(group_id::text)::uuid as group_id
        from live_owners
        group by user_id
        having count(*) = 1
      )
      insert into "formal_group_affiliations"
        ("id", "created_at", "updated_at", "user_id", "group_id", "started_on", "ended_on")
      select gen_random_uuid(), now(), now(), so.user_id, so.group_id, null, null
      from single_owners so
      where not exists (
        select 1 from "formal_group_affiliations" f
        where f.user_id = so.user_id and f.ended_on is null
      );
    `);
  }

  override async down(): Promise<void> {
    // Not reversible without guessing which rows this migration created
    // (it records nothing extra) - and ending/deleting affiliations would
    // be exactly the data loss it was written to avoid. No-op.
  }

}
