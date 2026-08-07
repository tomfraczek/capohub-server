import {
  Check,
  Entity,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Event } from '../../events/entities/event.entity';
import { Group } from '../../groups/entities/group.entity';
import { User } from '../../users/entities/user.entity';
import { Rank } from './rank.entity';

export const FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX =
  'formal_rank_assignments_user_id_active_unique';

// The single source of truth for a user's current and historical *formal*
// rank - a rank actually earned in a Group's catalog. Same "one row per
// stint, never overwritten, ended by setting endedOn" shape as
// FormalGroupAffiliation (see that entity's own comment for the
// rationale, and note the deliberately parallel "Formal*" naming - both
// represent a durable, career-relevant fact, as opposed to CustomUserRank,
// which is a purely cosmetic, freely-editable profile element with no
// history of its own - see custom-user-rank.entity.ts). The user's formal
// rank is a global part of their profile, never per-Group/per-Section -
// there is deliberately no `currentRankId` on User; "current formal rank"
// is always computed as the row with endedOn = null (see
// FormalRankService.getCurrent).
//
// `rank` and `sourceGroup` are both required (NOT NULL) - every row here
// is, by construction, a catalog Rank chosen from the exact Group whose
// catalog it came from. There is no "custom" variant of this entity at
// all (see the module spec: "CustomUserRank nie może trafiać do historii
// kariery") - a custom cordão is never written here, under any
// circumstance. Whether `sourceGroup` actually *matches*
// `rank.system.group` is a cross-table invariant only FormalRankService
// can check (see its own comment), same reasoning as Rank.previousRank's
// same-system/same-track rules.
//
// awardedByName is a free-text, optional, *declared* fact ("Mestre
// Marcão") - never a FK to User, since the person who awarded a rank often
// has no account in the app at all.
@Entity({ tableName: 'formal_rank_assignments' })
@Check<FormalRankAssignment>({
  name: 'formal_rank_assignments_ended_on_after_started_on_check',
  expression: (columns) =>
    `"${columns.startedOn}" is null or "${columns.endedOn}" is null or "${columns.endedOn}" >= "${columns.startedOn}"`,
})
@Unique({
  name: FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  properties: ['user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.user}") where ("${columns.endedOn}" is null)`,
})
export class FormalRankAssignment extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // No delete cascade - a catalog Rank is never physically deleted (it is
  // archived instead), so a historical assignment always keeps resolving.
  @Index()
  @ManyToOne(() => Rank, { deleteRule: 'no action' })
  rank!: Rank;

  // The exact Group whose catalog `rank` was chosen from. Never physically
  // deleted (ADR-007), so this reference is always resolvable.
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  sourceGroup!: Group;

  @Property({ nullable: true, type: 'date' })
  startedOn: Date | null = null;

  @Property({ nullable: true, type: 'date' })
  endedOn: Date | null = null;

  @Property({ nullable: true, length: 150 })
  awardedByName: string | null = null;

  // Optional evidence link to the Event where this rank was actually
  // awarded/received - see FormalRankService.setCurrent for the
  // eligibility checks run at write time (attended, not in the future,
  // viewer had access). Never physically deleted (ADR-007), so - like
  // `rank` and `sourceGroup` - this reference is always resolvable. Purely
  // an evidentiary reference: the rank's date of record stays
  // `startedOn`, never derived from the Event.
  @Index()
  @ManyToOne(() => Event, { nullable: true, deleteRule: 'no action' })
  event: Event | null = null;
}
