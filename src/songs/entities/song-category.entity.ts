import { Entity, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';

// A closed, globally-managed dictionary - users pick an existing category,
// they never type their own. See SongCategoryCode for the initial values.
@Entity({ tableName: 'song_categories' })
export class SongCategory extends BaseEntity {
  @Unique()
  @Property({ length: 50 })
  code!: string;

  @Property({ length: 100 })
  name!: string;

  @Property()
  position!: number;

  @Property()
  isActive: boolean = true;
}
