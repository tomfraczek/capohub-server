import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Song } from '../../songs/entities/song.entity';
import { Rhythm } from './rhythm.entity';

// Normalized relation between the existing Song aggregate and Rhythm,
// CMS-managed only (see admin rhythms endpoints - Song itself is never
// touched, per spec section 6/9). Cascade on both sides: the relation row
// is meaningless once either side is gone.
//
// `isPrimary` (at most one true row per songId) is enforced at the
// application level, inside the same transaction as every write that can
// change it - see RhythmsService.replaceSongLinks. No partial unique index
// backs it at the DB level (see the Etap report for why).
@Entity({ tableName: 'song_rhythms' })
@Unique({ properties: ['song', 'rhythm'] })
export class SongRhythm extends BaseEntity {
  @Index()
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Index()
  @ManyToOne(() => Rhythm, { deleteRule: 'cascade' })
  rhythm!: Rhythm;

  @Property()
  isPrimary: boolean = false;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;
}
