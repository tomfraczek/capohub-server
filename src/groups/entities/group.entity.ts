import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupVisibility } from '../enums/group-visibility.enum';

// Organizational data only - no address/location/academy/training-venue
// fields (those live on Academy/Section, each owned by exactly one Group).
// Membership (who belongs, with what role) lives on GroupMembership, not
// here.
@Entity({ tableName: 'groups' })
export class Group extends BaseEntity {
  // Hierarchy is represented exclusively by this self-reference - see
  // organization-domain.md#hierarchy. `null` means this Group is a Root
  // Group. Every mutation of this field must go through
  // GroupHierarchyService (attach at creation, move afterwards) - never set
  // directly elsewhere, so cycle-freedom and the "Root Group never changes"
  // invariant (ADR-002) stay centrally enforced. No delete cascade: a Group
  // is archived, never physically deleted, so a parent row is never removed
  // out from under its children (see ADR-007).
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  parentGroup: Group | null = null;

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Property({ nullable: true, length: 2048 })
  logoUrl: string | null = null;

  @Property({ nullable: true, length: 2048 })
  coverImageUrl: string | null = null;

  @Property({ nullable: true, length: 255 })
  contactEmail: string | null = null;

  @Property({ nullable: true, length: 50 })
  contactPhone: string | null = null;

  @Property({ nullable: true, length: 2048 })
  websiteUrl: string | null = null;

  @Property({ nullable: true, length: 2048 })
  facebookUrl: string | null = null;

  @Property({ nullable: true, length: 2048 })
  instagramUrl: string | null = null;

  @Property({ nullable: true, length: 2048 })
  youtubeUrl: string | null = null;

  @Enum({ items: () => Object.values(GroupVisibility) })
  visibility: GroupVisibility = GroupVisibility.PUBLIC;

  @Index()
  @Enum({ items: () => Object.values(GroupStatus) })
  status: GroupStatus = GroupStatus.ACTIVE;

  @Property({ length: 100 })
  timezone!: string;

  @Property({ length: 3 })
  currencyCode!: string;
}
