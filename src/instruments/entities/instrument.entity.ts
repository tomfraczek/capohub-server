import {
  Collection,
  Entity,
  Index,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { InstrumentMedia } from './instrument-media.entity';

// CMS-managed reference content (Muzyka > Instrumenty) - not created by
// regular users, no publication workflow, no author/moderation metadata.
// `isActive` is the only visibility switch: false hides it from every
// public endpoint without physically deleting it (see InstrumentsService).
@Entity({ tableName: 'instruments' })
export class Instrument extends BaseEntity {
  @Unique()
  @Property({ length: 120 })
  slug!: string;

  @Property({ length: 150 })
  name!: string;

  // Simple string list, not a normalized child entity like
  // SongAlternativeTitle - these are purely descriptive alternate spellings
  // with no need for individual addressing, ordering semantics beyond
  // insertion order, or per-item metadata (see the Etap report).
  @Property({ type: 'array' })
  alternativeNames: string[] = [];

  @Property({ nullable: true, length: 300 })
  shortDescription: string | null = null;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Property({ nullable: true, type: 'text' })
  history: string | null = null;

  @Property({ nullable: true, type: 'text' })
  construction: string | null = null;

  @Property({ nullable: true, type: 'text' })
  howToPlay: string | null = null;

  @Property({ nullable: true, type: 'text' })
  roleInBateria: string | null = null;

  @Index()
  @Property()
  displayOrder: number = 0;

  @Index()
  @Property()
  isActive: boolean = true;

  @OneToMany(() => InstrumentMedia, (media) => media.instrument, {
    orderBy: { displayOrder: 'ASC' },
  })
  media = new Collection<InstrumentMedia>(this);
}
