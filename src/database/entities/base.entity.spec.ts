import { Entity, MetadataStorage } from '@mikro-orm/core';
import { BaseEntity } from './base.entity';

// Local, test-only subclass. Not a real domain entity and never referenced
// by the entity globs used for discovery/migrations (this file doesn't
// match the `*.entity.ts` pattern).
@Entity()
class TestEntity extends BaseEntity {}

// MetadataStorage.getMetadataFromDecorator<T>() defaults T to `any`, which
// makes every `.properties.*` access untyped. This narrow shape is the only
// part of EntityMetadata these tests care about.
interface TestableMetadata {
  abstract: boolean;
  properties: {
    id: { primary?: boolean; type?: string };
    createdAt: { onCreate?: () => Date };
    updatedAt: { onCreate?: () => Date; onUpdate?: (entity: unknown) => Date };
  };
}

function getBaseEntityMetadata(): TestableMetadata {
  return MetadataStorage.getMetadataFromDecorator(
    BaseEntity,
  ) as unknown as TestableMetadata;
}

describe('BaseEntity', () => {
  it('generates a UUID for id', () => {
    const entity = new TestEntity();
    expect(entity.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a different id for each instance', () => {
    const a = new TestEntity();
    const b = new TestEntity();
    expect(a.id).not.toBe(b.id);
  });

  it('sets createdAt and updatedAt to Date instances', () => {
    const entity = new TestEntity();
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('maps id as a uuid primary key', () => {
    const meta = getBaseEntityMetadata();
    expect(meta.properties.id.primary).toBe(true);
    expect(meta.properties.id.type).toBe('uuid');
  });

  it('wires an onCreate hook for createdAt', () => {
    const meta = getBaseEntityMetadata();
    expect(typeof meta.properties.createdAt.onCreate).toBe('function');
  });

  it('wires onCreate and onUpdate hooks for updatedAt', () => {
    const meta = getBaseEntityMetadata();
    expect(typeof meta.properties.updatedAt.onCreate).toBe('function');
    expect(typeof meta.properties.updatedAt.onUpdate).toBe('function');
    const updated = meta.properties.updatedAt.onUpdate?.(new TestEntity());
    expect(updated).toBeInstanceOf(Date);
  });

  it('is registered as an abstract entity with no table of its own', () => {
    const meta = getBaseEntityMetadata();
    expect(meta.abstract).toBe(true);
  });
});
