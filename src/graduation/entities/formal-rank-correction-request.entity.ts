import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import {
  ACTIVE_FORMAL_RANK_CORRECTION_STATUSES,
  FormalRankCorrectionStatus,
} from '../enums/formal-rank-correction-status.enum';
import { FormalRankAssignment } from './formal-rank-assignment.entity';
import { Rank } from './rank.entity';

export const FORMAL_RANK_CORRECTION_REQUESTS_ACTIVE_UNIQUE_INDEX =
  'formal_rank_correction_requests_assignment_active_unique';

// A Section OWNER/ADMIN's report that a member's *formal* rank
// (FormalRankAssignment) was recorded incorrectly, and the resulting
// review workflow to fix it. This is explicitly NOT a new rank award: it
// never ends the existing FormalRankAssignment and never creates a new
// history row - see FormalRankCorrectionService.approve, which corrects
// `rank` (and optionally `awardedByName`) on the very same row, leaving
// `startedOn`/`endedOn`/`sourceGroup` untouched.
//
// Lifecycle (see FormalRankCorrectionStatus):
//   CORRECTION_REQUIRED (an OWNER/ADMIN flagged it, target hasn't
//     responded yet)
//   → PENDING_APPROVAL (target submitted `submittedRank`)
//   → APPROVED (terminal - reviewer applied the correction) or
//     REJECTED (not terminal - target may submit again, looping back to
//     PENDING_APPROVAL; see FormalRankCorrectionService.submit)
//
// One row is reused across an arbitrary number of submit/reject cycles -
// a new row is only ever created by a *fresh* report (request()), never
// by a resubmission. Every individual reject decision is still
// permanently recoverable from AuditLogEntry (see
// FormalRankCorrectionService's audit calls), even though this row's own
// `rejectionReason` only ever reflects the most recent one.
//
// At most one *active* (CORRECTION_REQUIRED/PENDING_APPROVAL/REJECTED)
// request per FormalRankAssignment - see the partial unique index below.
// An APPROVED request does not block a later, brand-new report against
// the same assignment (its rank may need correcting again someday).
@Entity({ tableName: 'formal_rank_correction_requests' })
@Unique({
  name: FORMAL_RANK_CORRECTION_REQUESTS_ACTIVE_UNIQUE_INDEX,
  properties: ['formalRankAssignment'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.formalRankAssignment}") where ("${columns.status}" in (${ACTIVE_FORMAL_RANK_CORRECTION_STATUSES.map((s) => `'${s}'`).join(', ')}))`,
})
export class FormalRankCorrectionRequest extends BaseEntity {
  // The exact row being corrected. Cascades with its FormalRankAssignment
  // (which itself cascades from User) - a correction request has no
  // independent meaning once the assignment/user it's about is gone (see
  // formal-rank-assignment.entity.ts / user.entity.ts's own cascade
  // choice for the same reasoning).
  @Index()
  @ManyToOne(() => FormalRankAssignment, { deleteRule: 'cascade' })
  formalRankAssignment!: FormalRankAssignment;

  // Denormalized against formalRankAssignment.user for direct
  // indexing/filtering (list-by-targetUser) without a join. Always kept
  // in sync at creation time - a request is never retargeted to a
  // different user.
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  targetUser!: User;

  // The exact Section this workflow belongs to - never a resolved root,
  // never inherited (see the module spec's "no inheritance" rule). Never
  // physically deleted (ADR-007), so this reference always resolves.
  @Index()
  @ManyToOne(() => Section, { deleteRule: 'no action' })
  section!: Section;

  // Who flagged the rank as incorrect. `set null` (not cascade) - an
  // actor reference, same policy as RoleAssignment.grantedBy/revokedBy:
  // deleting the reporter's account must never delete another user's
  // correction history, only anonymize who requested it.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  reportedBy: User | null = null;

  @Index()
  @Enum({ items: () => Object.values(FormalRankCorrectionStatus) })
  status: FormalRankCorrectionStatus =
    FormalRankCorrectionStatus.CORRECTION_REQUIRED;

  // The target's proposed replacement Rank - set once they submit (see
  // FormalRankCorrectionService.submit), re-set on every resubmission
  // after a rejection. No delete cascade - Rank is archived, never
  // physically deleted.
  @Index()
  @ManyToOne(() => Rank, { nullable: true, deleteRule: 'no action' })
  submittedRank: Rank | null = null;

  // Optional corrected awardedByName, submitted alongside submittedRank.
  // `null` means "no change proposed to awardedByName" - see
  // FormalRankCorrectionService.approve, which only overwrites the
  // assignment's awardedByName when this is non-null.
  @Property({ nullable: true, length: 150 })
  submittedAwardedByName: string | null = null;

  // The reporter's optional explanation for flagging this rank, set once
  // at creation and never changed afterward.
  @Property({ nullable: true, type: 'text' })
  reason: string | null = null;

  @Property({ nullable: true, type: 'timestamptz' })
  submittedAt: Date | null = null;

  @Property({ nullable: true, type: 'timestamptz' })
  reviewedAt: Date | null = null;

  // Who approved/rejected - same `set null` actor policy as reportedBy.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  reviewedBy: User | null = null;

  // Only ever meaningful after a REJECTED decision - see
  // FormalRankCorrectionService.reject. Holds only the *most recent*
  // rejection's reason; every individual past decision (including its own
  // reason) remains in AuditLogEntry.metadata (see this entity's own
  // top comment).
  @Property({ nullable: true, type: 'text' })
  rejectionReason: string | null = null;
}
