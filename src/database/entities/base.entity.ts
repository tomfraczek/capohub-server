import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

@Entity({ abstract: true })
export abstract class BaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt: Date = new Date();
}
