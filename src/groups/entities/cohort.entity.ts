import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { CohortStatus } from '../enums/cohort-status.enum';
import { Group } from './group.entity';

// Cohort divides a Group's members for management convenience only - it
// is optional, has no child cohorts, and creates no hierarchy of its own
// (see ADR-003, formerly "Section" before the Group/Section domain rename -
// see the rename ADR). It always belongs to exactly one Group. Assigning
// Memberships to a Cohort is out of scope for this stage - see
// organization-entities.md#cohort.
@Entity({ tableName: 'cohorts' })
export class Cohort extends BaseEntity {
  // No delete cascade - Cohort is archived, never physically deleted (see
  // ADR-007).
  @Index()
  @ManyToOne(() => Group)
  group!: Group;

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Index()
  @Enum({ items: () => Object.values(CohortStatus) })
  status: CohortStatus = CohortStatus.ACTIVE;
}
