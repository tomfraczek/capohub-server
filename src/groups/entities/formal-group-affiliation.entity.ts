import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';

export const FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX =
  'formal_group_affiliations_user_id_active_unique';

// One row per stint of a capoeirista's single, formal (real-world) school
// affiliation - distinct from SectionMembership, which is the *application*
// membership a user can hold in many Sections at once (see
// UserProfileService). Never overwritten across a change: setting a new
// formal Group ends the current row (endedOn set) and inserts a fresh one,
// atomically, in the same transaction - so history is preserved. At most
// one row with endedOn = null per user, enforced by the partial unique
// index below (application-side, transactionally, *and* this index as a
// database-level backstop against races - same pattern as
// SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX).
//
// Always targets a Group, never a Section - a formal affiliation is with
// the school/organization as a whole, not any one of its physical
// locations (see group.entity.ts/section.entity.ts split).
//
// startedOn/endedOn are the real-world dates this affiliation covers, not
// "when this row was written" (that's createdAt/updatedAt, from
// BaseEntity) - they exist to seed a future career-timeline feature, so
// neither is silently defaulted: startedOn stays null if the user doesn't
// supply it (never a guessed date), and endedOn is only ever set by
// UserProfileService when a stint actually ends.
//
// Ending the user's last active SectionMembership within this Group's
// hierarchy - or the Group/qualifying Section later being archived - does
// NOT end this row automatically. A formal affiliation is a durable,
// user-declared statement ("this is my school"), not a derived fact
// continuously re-verified against live membership/status (mirrors
// EventRoleAssignment's documented choice not to evaporate when the
// holder later leaves the Community - see event-role-assignment.entity.ts,
// ADR-019). The Group/Section status checks in
// UserProfileService.setFormalGroup only run at set/change time. It only
// ends when the user explicitly changes or clears it (see
// UserProfileService.setFormalGroup/endFormalGroup).
//
// No endedBy/endReason - unlike SectionMembership, every end of a
// FormalGroupAffiliation is self-initiated (only the owning user may set
// or end it), so there is only ever one possible actor.
@Entity({ tableName: 'formal_group_affiliations' })
@Unique({
  name: FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX,
  properties: ['user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.user}") where ("${columns.endedOn}" is null)`,
})
export class FormalGroupAffiliation extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  group!: Group;

  @Property({ nullable: true, type: 'date' })
  startedOn: Date | null = null;

  @Property({ nullable: true, type: 'date' })
  endedOn: Date | null = null;
}
