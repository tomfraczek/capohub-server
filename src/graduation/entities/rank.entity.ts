import {
  Check,
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
import { RankTrack } from '../enums/rank-track.enum';
import { GraduationSystem } from './graduation-system.entity';
import { RankCordSegment } from './rank-cord-segment.entity';

export const RANKS_PREVIOUS_RANK_UNIQUE_INDEX = 'ranks_previous_rank_id_unique';
export const RANKS_FIRST_RANK_PER_TRACK_UNIQUE_INDEX =
  'ranks_system_id_track_first_rank_unique';

// A single catalog entry belonging to exactly one GraduationSystem and one
// track (CHILD or ADULT). There is deliberately no `sortOrder` column - the
// only valid ordering is the one derivable by walking `previousRank`
// (see rank-chain.ts), so it can never drift out of sync with the actual
// chain the way a redundant sortOrder integer could.
//
// The chain invariants (previousRank same system/track, no self-reference,
// no cycles, at most one direct successor per rank, at most one first rank
// - previousRank null - per system+track) are enforced by RanksService.
// Only the invariants expressible as a single-row CHECK or a plain/partial
// unique index live at the DB level here, as a backstop against bugs, not
// as the primary source of truth (see RanksService.assertNoCycle and
// friends for the rest, which need to read other rows).
@Entity({ tableName: 'ranks' })
// A Rank may never point to itself as its own previous rank.
@Check<Rank>({
  name: 'ranks_previous_rank_not_self_check',
  expression: (columns) =>
    `"${columns.previousRank}" is null or "${columns.previousRank}" <> "${columns.id}"`,
})
// At most one direct successor per rank - i.e. no branching. Combined with
// RANKS_FIRST_RANK_PER_TRACK_UNIQUE_INDEX below and RanksService's cycle
// check, this makes every track a simple linked list.
@Unique({
  name: RANKS_PREVIOUS_RANK_UNIQUE_INDEX,
  properties: ['previousRank'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.previousRank}") where ("${columns.previousRank}" is not null)`,
})
// At most one "first rank" (previousRank is null) per (system, track).
@Unique({
  name: RANKS_FIRST_RANK_PER_TRACK_UNIQUE_INDEX,
  properties: ['system', 'track'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.system}", "${columns.track}") where ("${columns.previousRank}" is null)`,
})
export class Rank extends BaseEntity {
  // No delete cascade - a GraduationSystem is never physically deleted, so
  // this is a defensive "no action" like every other reference to a
  // never-deleted parent in this codebase (Academy.group, etc.).
  @Index()
  @ManyToOne(() => GraduationSystem, { deleteRule: 'no action' })
  system!: GraduationSystem;

  @Index()
  @Enum({ items: () => Object.values(RankTrack) })
  track!: RankTrack;

  // The masculine form, and the default one shown whenever the holder isn't
  // FEMALE or nameFemale is missing - see rank-name.util.ts.
  @Property({ length: 150 })
  name!: string;

  // The feminine form ("Graduada" for "Graduado"), named by the Group itself
  // - never derived from `name`. Null only on ranks created before it
  // existed; createRankSchema/updateRankSchema require it, so the next edit
  // of such a rank fills it in.
  @Property({ length: 150, nullable: true })
  nameFemale: string | null = null;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  // The single source of gradation order - see rank-chain.ts. Null means
  // "this is the first rank of its track". No delete cascade: archiving
  // (the only supported removal) never touches this FK, so a Rank never
  // disappears out from under whichever Rank points to it as previousRank.
  @Index()
  @ManyToOne(() => Rank, { nullable: true, deleteRule: 'no action' })
  previousRank: Rank | null = null;

  // Never physically deleted once created (see the module spec's
  // archiving rules) - isArchived is the only removal state. An archived
  // Rank stays in its chain position (see rank-chain.ts) and remains
  // selectable as historical/current data, but is excluded from the "may
  // be newly selected" set (see FormalRankService).
  @Property()
  isArchived: boolean = false;

  @OneToMany(() => RankCordSegment, (segment) => segment.rank)
  cordSegments = new Collection<RankCordSegment>(this);
}
