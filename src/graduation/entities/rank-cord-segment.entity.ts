import {
  Check,
  Entity,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Rank } from './rank.entity';

// One colored segment of a Rank's cord, ordered end-to-end by `position`
// (ascending). Deliberately no "tip"/"main color" typed fields - a cord
// with one color, two colors, many colors, matching or differing tips is
// just N segments in a row (see the module spec's rationale). Always
// replaced as a whole list by RanksService.replaceCordSegments - never
// patched segment-by-segment - so there is no per-segment update endpoint.
@Entity({ tableName: 'rank_cord_segments' })
@Unique({ properties: ['rank', 'position'] })
@Check<RankCordSegment>({
  name: 'rank_cord_segments_color_hex_check',
  expression: (columns) => `"${columns.colorHex}" ~ '^#[0-9A-Fa-f]{6}$'`,
})
@Check<RankCordSegment>({
  name: 'rank_cord_segments_proportion_positive_check',
  expression: (columns) => `"${columns.proportion}" > 0::double precision`,
})
export class RankCordSegment extends BaseEntity {
  // Owned child row - cascades with its Rank. This never fires in practice
  // (a Rank is never physically deleted), but keeps the table honest if
  // that ever changes.
  @Index()
  @ManyToOne(() => Rank, { deleteRule: 'cascade' })
  rank!: Rank;

  @Property({ type: 'smallint' })
  position!: number;

  // '#RRGGBB', backstopped by the DB CHECK above; also validated at the
  // Zod schema layer (see cord-segment.schema.ts).
  @Property({ length: 7 })
  colorHex!: string;

  // Percentage of the cord's length this segment occupies. `float` rather
  // than `decimal` - MikroORM's postgres driver round-trips `decimal` as a
  // string at runtime (to avoid precision loss), which this module has no
  // need for at percentage-of-100 precision; `float` matches the
  // convention already used for Academy.latitude/longitude. The "segments
  // for one Rank must sum to exactly 100" invariant spans multiple rows,
  // so it cannot be a single-row CHECK - it is validated by the
  // cordSegments Zod schema against the *entire incoming list* on every
  // create/update, which is safe here because segments are always
  // replaced as a complete list in one request/transaction, never
  // appended to incrementally (see RanksService.replaceCordSegments).
  @Property({ type: 'float' })
  proportion!: number;
}
