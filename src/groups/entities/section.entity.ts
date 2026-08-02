import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { GroupStatus } from '../enums/group-status.enum';
import { Group } from './group.entity';

// Section is a distinct, physically-stored entity type - never a Group in
// disguise (see the Group/Section physical-split ADR, stage 1 of the
// organizational-domain rebuild). A Section may exist on its own (no
// parent) or be attached to exactly one Group; it can never have children
// of its own (no other Group or Section may set this row as its parent) -
// only GroupHierarchyService may mutate `parentGroup` (attach/detach), so
// every cycle/kind rule stays centrally enforced and is never duplicated in
// a controller.
//
// Field set mirrors Group's branding/contact/visibility fields (both are
// used by Sections today - see create-section.schema.ts), but Section alone
// carries the physical-location fields (country/city/region/geonameId) -
// a Group is an organizational container that may span many places (or
// none), while a Section always operates in one specific place.
@Entity({ tableName: 'sections' })
export class Section extends BaseEntity {
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

  // ISO 3166-1 alpha-2 (e.g. "PL") - validated in the application layer,
  // cross-checked against `geonameId` (see
  // group-validation.helpers.ts#refineCityIdentification).
  @Property({ nullable: true, length: 2 })
  country: string | null = null;

  @Property({ nullable: true, length: 100 })
  city: string | null = null;

  @Property({ nullable: true, length: 100 })
  region: string | null = null;

  @Property({ nullable: true })
  geonameId: number | null = null;

  @Property()
  isPublic: boolean = true;

  @Property()
  isHidden: boolean = false;

  @Property()
  memberInvitesAllowed: boolean = false;

  @Unique()
  @Property({ nullable: true, length: 15 })
  publicCode: string | null = null;

  @Index()
  @Enum({ items: () => Object.values(GroupStatus) })
  status: GroupStatus = GroupStatus.ACTIVE;

  @Property({ length: 100 })
  timezone!: string;

  @Property({ length: 3 })
  currencyCode!: string;
}
