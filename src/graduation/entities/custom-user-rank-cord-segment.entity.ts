import {
  Check,
  Entity,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { CustomUserRank } from './custom-user-rank.entity';

// Same shape and validation rules as RankCordSegment (see that entity's
// comment) - kept as its own entity/table rather than a shared polymorphic
// "cord segment" pointing at either a Rank or a CustomUserRank, since a
// dual-nullable-FK model would let a segment reference both or neither,
// which cord segments have no legitimate reason to ever do (unlike
// Group-or-Section, which genuinely is "one of two kinds of the same
// concept"). Validation logic (hex format, positive proportion, sums to
// 100) is shared at the Zod schema layer instead - see
// cord-segment.schema.ts.
@Entity({ tableName: 'custom_user_rank_cord_segments' })
@Unique({ properties: ['customRank', 'position'] })
@Check<CustomUserRankCordSegment>({
  name: 'custom_user_rank_cord_segments_color_hex_check',
  expression: (columns) => `"${columns.colorHex}" ~ '^#[0-9A-Fa-f]{6}$'`,
})
@Check<CustomUserRankCordSegment>({
  name: 'custom_user_rank_cord_segments_proportion_positive_check',
  expression: (columns) => `"${columns.proportion}" > 0::double precision`,
})
export class CustomUserRankCordSegment extends BaseEntity {
  @Index()
  @ManyToOne(() => CustomUserRank, { deleteRule: 'cascade' })
  customRank!: CustomUserRank;

  @Property({ type: 'smallint' })
  position!: number;

  @Property({ length: 7 })
  colorHex!: string;

  // See RankCordSegment.proportion's own comment for why `float`, not
  // `decimal`.
  @Property({ type: 'float' })
  proportion!: number;
}
