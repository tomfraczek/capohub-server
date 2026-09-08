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
// Backs the bounding-box pre-filter CommunityOverviewService's nearby
// queries run before scoring exact haversine distance (see
// common/geo/distance.ts) - a plain btree composite index still lets
// Postgres range-scan `latitude between ? and ?` efficiently even though it
// cannot express a true 2D radius search the way a PostGIS GiST index would
// (deliberately not introduced yet - see that service's own comment on the
// upgrade path once real geospatial scale requires it).
@Index({ properties: ['latitude', 'longitude'] })
export class Section extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  parentGroup: Group | null = null;

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  // Legacy URL field - see the identical comment on Group.logoUrl
  // (group.entity.ts): still PATCH-able, still rendered as a fallback, but
  // no longer authoritative once profileImageKey is set.
  @Property({ nullable: true, length: 2048 })
  logoUrl: string | null = null;

  // Same legacy-URL-vs-R2-key relationship as logoUrl/profileImageKey
  // above, just for the cover image - see SectionsService.uploadCoverImage.
  // Cleared to null the moment the first R2 cover upload happens. A
  // Section *cover* upload now exists (module: "zbuduj pełne tło sekcji od
  // zera") - mirrors Group's own cover image feature exactly (16:9,
  // ImageProcessingService.processCoverImage), this field predates that and
  // was, until now, decorative-only.
  @Property({ nullable: true, length: 2048 })
  coverImageUrl: string | null = null;

  // R2 object key ("sections/{id}/profile/{uuid}.webp" - see
  // storage/object-keys.util.ts) for this Section's uploaded profile
  // image; null until the first upload.
  @Property({ nullable: true, length: 512 })
  profileImageKey: string | null = null;

  // R2 object key ("sections/{id}/cover/{uuid}.webp") for this Section's
  // uploaded cover image; null until the first upload. See coverImageUrl's
  // own comment above for how the two fields relate.
  @Property({ nullable: true, length: 512 })
  coverImageKey: string | null = null;

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

  // Precise venue coordinates - distinct from country/city/region/geonameId
  // above (a city-level, text/identifier-based location kept for display and
  // create/update validation - see group-validation.helpers.ts). The bundled
  // GeoNames city dataset (common/geo/city-directory.ts) carries no
  // latitude/longitude at all, so nearby discovery (see
  // CommunityOverviewService) cannot derive a coordinate from geonameId and
  // needs its own pair here - same nullable-float shape as Academy/Event's
  // own latitude/longitude (see academy.entity.ts, event.entity.ts), the
  // established "location" shape in this codebase, reused rather than
  // duplicated with a different type. Both nullable and always set together
  // (see refineCoordinatePair in group-validation.helpers.ts) - a Section
  // with neither set simply never appears in nearby discovery (module:
  // "Grupy bez sekcji posiadających lokalizację nie powinny pojawiać się w
  // nearby discovery").
  @Property({ nullable: true, type: 'float' })
  latitude: number | null = null;

  @Property({ nullable: true, type: 'float' })
  longitude: number | null = null;

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
