import {
  Collection,
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { RankTrack } from '../enums/rank-track.enum';
import { CustomUserRankCordSegment } from './custom-user-rank-cord-segment.entity';

export const CUSTOM_USER_RANKS_ACTIVE_UNIQUE_INDEX =
  'custom_user_ranks_user_id_active_unique';

// A user-declared ("independent") rank - one not confirmed in any Group's
// graduation system, e.g. earned outside a formal Group. Never written to
// FormalRankAssignment (see that entity's own comment) and has no catalog:
// no `previousRank`/position/system, belongs to exactly one user.
// Deliberately a separate entity from Rank rather than a shared
// polymorphic "rank" base: the two have almost no fields in common once
// GraduationSystem/previousRank/isArchived are removed.
//
// Same "one row per stint, never overwritten, ended by setting endedOn"
// shape as FormalRankAssignment, so a past independent rank stays a real,
// structured part of the user's history (career timeline RECEIVED_RANK)
// instead of disappearing when replaced. At most one *active* row
// (endedOn = null) per user - see the partial unique index below.
//
// A user has at most one active rank overall - this or a
// FormalRankAssignment, never both (see CustomUserRankService.setCurrent,
// which ends the formal one, and FormalRankRequestsService.approve, which
// ends this one). While the user has an active formal Group, their
// independent rank is read-only: it can neither be set, changed nor ended
// (CustomUserRankService) - a rank inside a formal Group only ever comes
// from its graduation system, through a confirmed FormalRankRequest.
@Entity({ tableName: 'custom_user_ranks' })
@Unique({
  name: CUSTOM_USER_RANKS_ACTIVE_UNIQUE_INDEX,
  properties: ['user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.user}") where ("${columns.endedOn}" is null)`,
})
export class CustomUserRank extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Enum({ items: () => Object.values(RankTrack) })
  track!: RankTrack;

  @OneToMany(() => CustomUserRankCordSegment, (segment) => segment.customRank)
  cordSegments = new Collection<CustomUserRankCordSegment>(this);

  // Real-world dates this stint covers, same meaning as
  // FormalRankAssignment's. startedOn is never guessed - null when the user
  // didn't give one (the timeline then dates it by createdAt, the moment
  // it was declared in the app).
  @Property({ nullable: true, type: 'date' })
  startedOn: Date | null = null;

  @Property({ nullable: true, type: 'date' })
  endedOn: Date | null = null;
}
