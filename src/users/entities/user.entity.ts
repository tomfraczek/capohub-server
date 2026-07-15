import { Entity, Index, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';

@Entity({ tableName: 'users' })
export class User extends BaseEntity {
  @Unique()
  @Property()
  clerkUserId!: string;

  // Always stored trimmed + lowercased; normalization happens where the
  // value is written (UserService), not here - MikroORM entities stay plain.
  @Index()
  @Property()
  email!: string;

  @Property({ nullable: true, type: 'string' })
  firstName: string | null = null;

  @Property({ nullable: true, type: 'string' })
  lastName: string | null = null;

  @Property({ nullable: true, type: 'string' })
  imageUrl: string | null = null;

  @Property()
  isActive: boolean = true;

  @Property({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null = null;
}
