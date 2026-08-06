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

// A purely cosmetic, user-declared cordão - never a formal rank, never
// career history, and never written to FormalRankAssignment (see that
// entity's own comment and CustomUserRankService). Only ever meaningful
// (selectable as `isActive`) while its owner has no active
// FormalGroupAffiliation - see CustomUserRankService. Not a catalog: has
// no `previousRank`/position/system, and belongs to exactly one user.
// Deliberately a separate entity from Rank rather than a shared
// polymorphic "rank" base: the two have almost no fields in common once
// GraduationSystem/previousRank/isArchived are removed, and sharing a
// table would force every catalog-only column to be nullable here for no
// benefit.
//
// `isActive` marks "the cordão currently shown on this user's profile" -
// at most one per user (see the partial unique index below). Setting a
// new one active deactivates whichever was active before (see
// CustomUserRankService.activate); it is never deleted or ended in the
// process - a CustomUserRank has no history/lifecycle of its own, it
// simply sits there, active or not, until its owner explicitly edits or
// deletes it (see the module spec: "może być swobodnie edytowane... bo
// nie jest historycznym rekordem kariery"). Selecting a formal Rank
// (FormalRankService.setCurrent) deactivates the active one, if any, but
// never deletes it - and leaving the formal Group afterwards does not
// automatically reactivate it (both per the module spec).
@Entity({ tableName: 'custom_user_ranks' })
@Unique({
  name: CUSTOM_USER_RANKS_ACTIVE_UNIQUE_INDEX,
  properties: ['user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.user}") where ("${columns.isActive}" is true)`,
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

  @Property()
  isActive: boolean = false;

  @OneToMany(() => CustomUserRankCordSegment, (segment) => segment.customRank)
  cordSegments = new Collection<CustomUserRankCordSegment>(this);
}
