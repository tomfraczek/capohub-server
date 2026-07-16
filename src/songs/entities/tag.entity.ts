import { Entity, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';

// Global, curated tag dictionary. Users pick from existing tags when adding
// a song (Etap 8.2+); tag creation/management endpoints don't exist yet.
@Entity({ tableName: 'tags' })
export class Tag extends BaseEntity {
  @Unique()
  @Property({ length: 100 })
  name!: string;

  @Unique()
  @Property({ length: 120 })
  slug!: string;

  @Property()
  isActive: boolean = true;
}
