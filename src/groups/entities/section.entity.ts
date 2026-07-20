import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { SectionStatus } from '../enums/section-status.enum';
import { Group } from './group.entity';

// Section divides a Group's members for management convenience only - it
// is optional, has no child sections, and creates no hierarchy of its own
// (see ADR-003). It always belongs to exactly one Group. Assigning
// Memberships to a Section is out of scope for this stage - see
// organization-entities.md#section.
@Entity({ tableName: 'sections' })
export class Section extends BaseEntity {
  // No delete cascade - Section is archived, never physically deleted (see
  // ADR-007).
  @Index()
  @ManyToOne(() => Group)
  group!: Group;

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Index()
  @Enum({ items: () => Object.values(SectionStatus) })
  status: SectionStatus = SectionStatus.ACTIVE;
}
