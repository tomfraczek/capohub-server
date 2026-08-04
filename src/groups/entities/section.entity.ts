import {
  Check,
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
// Mirrors the identically-named, identically-defined constraint the old
// Group entity carried before the physical split (see
// Migration20260728140000_AddGroupCountryAndCity) - kept in metadata here
// too so migration:create/schema:update know it's intentional and never
// propose dropping it. Name matches the constraint the migration creates
// verbatim - see Migration20260802100000_SplitGroupsAndSections.
@Check<Section>({
  name: 'sections_country_check',
  expression: (columns) =>
    `"${columns.country}" is null or "${columns.country}" ~ '^[A-Z]{2}$'`,
})
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

  // `type: 'number'` is explicit, not redundant: TS's emitDecoratorMetadata
  // erases a `T | null` union to `Object` at the reflection level (the same
  // reason Academy.latitude/longitude declare `type: 'float'` explicitly),
  // so leaving this implicit silently fell back to a generic string column
  // instead of the `integer` column the migration actually creates.
  @Property({ nullable: true, type: 'number' })
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
