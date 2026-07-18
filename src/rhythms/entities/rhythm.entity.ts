import {
  Check,
  Collection,
  Entity,
  Index,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { RhythmMedia } from './rhythm-media.entity';

// CMS-managed reference content (Muzyka > Rytmy) - same non-goals as
// Instrument: no author/moderation metadata, no publication workflow.
// `character`/`usage` are deliberately free text, not an enum - the "role"
// a rhythm plays can differ by tradition/group (see the Etap report).
@Entity({ tableName: 'rhythms' })
@Check<Rhythm>({
  expression: (columns) =>
    `${columns.tempoMinBpm} is null or ${columns.tempoMaxBpm} is null or ${columns.tempoMinBpm} <= ${columns.tempoMaxBpm}`,
})
export class Rhythm extends BaseEntity {
  @Unique()
  @Property({ length: 120 })
  slug!: string;

  @Property({ length: 150 })
  name!: string;

  // See Instrument.alternativeNames for why this is a plain array column,
  // not a normalized child entity.
  @Property({ type: 'array' })
  alternativeNames: string[] = [];

  @Property({ nullable: true, length: 300 })
  shortDescription: string | null = null;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Property({ nullable: true, type: 'text' })
  history: string | null = null;

  @Property({ nullable: true, type: 'text' })
  usage: string | null = null;

  @Property({ nullable: true, type: 'text' })
  character: string | null = null;

  @Property({ nullable: true, length: 300 })
  tempoDescription: string | null = null;

  @Property({ nullable: true, type: 'smallint' })
  tempoMinBpm: number | null = null;

  @Property({ nullable: true, type: 'smallint' })
  tempoMaxBpm: number | null = null;

  @Index()
  @Property()
  displayOrder: number = 0;

  @Index()
  @Property()
  isActive: boolean = true;

  @OneToMany(() => RhythmMedia, (media) => media.rhythm, {
    orderBy: { displayOrder: 'ASC' },
  })
  media = new Collection<RhythmMedia>(this);
}
