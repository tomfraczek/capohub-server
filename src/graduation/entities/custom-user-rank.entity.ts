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

export const CUSTOM_USER_RANKS_USER_UNIQUE_INDEX =
  'custom_user_ranks_user_id_unique';

// A purely cosmetic, user-declared cordão - never a formal rank, never
// career history, and never written to FormalRankAssignment (see that
// entity's own comment and CustomUserRankService). Not a catalog: has no
// `previousRank`/position/system, and belongs to exactly one user.
// Deliberately a separate entity from Rank rather than a shared
// polymorphic "rank" base: the two have almost no fields in common once
// GraduationSystem/previousRank/isArchived are removed, and sharing a
// table would force every catalog-only column to be nullable here for no
// benefit.
//
// A true singleton, at most one row per user (see the plain unique
// constraint below) - there is no `isActive`/activation concept any more,
// so a user simply has an independent rank or does not. Setting it
// (CustomUserRankService.setCurrent) is an upsert: update in place if a
// row already exists, insert otherwise. Which of a user's formal rank and
// this independent rank "counts" for display is now purely a display-time
// decision made by callers (e.g. the public profile surface, or the
// client) - the backend no longer mutates this row as a side effect of a
// formal rank being selected (see FormalRankService.setCurrent).
@Entity({ tableName: 'custom_user_ranks' })
@Unique({
  name: CUSTOM_USER_RANKS_USER_UNIQUE_INDEX,
  properties: ['user'],
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
}
