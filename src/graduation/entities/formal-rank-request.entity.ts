import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Event } from '../../events/entities/event.entity';
import { Group } from '../../groups/entities/group.entity';
import { User } from '../../users/entities/user.entity';
import { FormalRankRequestStatus } from '../enums/formal-rank-request-status.enum';
import { Rank } from './rank.entity';

export const FORMAL_RANK_REQUESTS_PENDING_UNIQUE_INDEX =
  'formal_rank_requests_user_id_pending_unique';

// A user's declaration "this is my rank in my formal Group's graduation
// system", waiting for someone authorized in that Group
// (FORMAL_RANK_REQUEST_REVIEW - Group OWNER/ADMIN) to confirm it. Choosing a
// formal rank never takes effect on its own any more: PUT
// /users/me/formal-rank creates one of these (see FormalRankService.setCurrent),
// and only approval writes the FormalRankAssignment - with the exact
// rank/startedOn/awardedByName/event declared here - ending the previous
// current rank (formal or independent) the usual non-destructive way.
//
// Deliberately its own entity rather than an extension of
// FormalRankCorrectionRequest: that one corrects an *existing*
// FormalRankAssignment in place, Section-scoped, initiated by a Section
// admin - this one proposes a *new* assignment, Group-scoped, initiated by
// the user. Different subject, scope, initiator and outcome.
//
// The fields mirror SetFormalRankInput 1:1, validated at request time the
// same way the immediate path always was (catalog of the requester's
// formal Group, not archived, startedOn not in the future, event
// eligibility) and re-checked on approval where they can have drifted.
//
// At most one PENDING request per user (partial unique index below): a
// user has one formal Group, so one rank can be awaiting confirmation at a
// time - a new request cancels the previous one.
@Entity({ tableName: 'formal_rank_requests' })
@Unique({
  name: FORMAL_RANK_REQUESTS_PENDING_UNIQUE_INDEX,
  properties: ['user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.user}") where ("${columns.status}" = 'PENDING')`,
})
export class FormalRankRequest extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // The requester's formal Group when the request was sent - whose
  // reviewers decide it. Never physically deleted (ADR-007).
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  group!: Group;

  // A Rank from `group`'s own catalog. Archived, never deleted.
  @ManyToOne(() => Rank, { deleteRule: 'no action' })
  rank!: Rank;

  @Property({ nullable: true, type: 'date' })
  startedOn: Date | null = null;

  @Property({ nullable: true, length: 150 })
  awardedByName: string | null = null;

  @ManyToOne(() => Event, { nullable: true, deleteRule: 'no action' })
  event: Event | null = null;

  @Index()
  @Enum({ items: () => Object.values(FormalRankRequestStatus) })
  status: FormalRankRequestStatus = FormalRankRequestStatus.PENDING;

  @Property({ nullable: true, type: 'timestamptz' })
  decidedAt: Date | null = null;

  // Who approved/rejected - `set null`, same actor policy as
  // FormalRankCorrectionRequest.reviewedBy. Null for CANCELLED.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  decidedBy: User | null = null;
}
