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

// Organizational data only - no address/location/academy/training-venue
// fields (those live on Academy/Cohort, each owned by exactly one Group).
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

  // ISO 3166-1 alpha-2 (e.g. "PL"), validated in the application layer -
  // see countryCodeSchema. Required on create/update for both Group and
  // Section (see create-group.schema.ts / create-section.schema.ts, both
  // enforced full-replace on update too) - still `nullable: true` at the DB
  // layer only because existing rows predate this field and there is no
  // value to safely backfill onto them; every new write goes through the
  // application-layer schema, which never lets it be saved empty again.
  @Property({ nullable: true, length: 2 })
  country: string | null = null;

  // Free text - kept only for display, compatibility, and simple filtering
  // (e.g. GET /discovery/search's `city` filter) - `geonameId` (below) is
  // the actual source of truth for identity; this is required to equal
  // that record's own name exactly (see
  // group-validation.helpers.ts#refineCityIdentification). Required on
  // create/update for both Group and Section, same DB-nullable-for-legacy-
  // rows caveat as `country` above.
  @Property({ nullable: true, length: 100 })
  city: string | null = null;

  // The admin1 region name (e.g. "Mazovia") - display/compatibility only,
  // same as `city` above; required to equal `geonameId`'s own region
  // exactly (see group-validation.helpers.ts#refineCityIdentification).
  // Nullable at the DB layer for the same reason as `country`/`city` above
  // - existing rows predate this field - and also legitimately `null` on a
  // fully up-to-date row whose city has no admin1 region in the source.
  @Property({ nullable: true, length: 100 })
  region: string | null = null;

  // The GeoNames-assigned, globally stable identifier for this city (see
  // common/geo/city-directory.ts) - the actual source of truth
  // `country`/`city`/`region` are cross-checked against on every create
  // and update (see group-validation.helpers.ts#refineCityIdentification).
  // Unlike `country`/`city`/`region`, a `null` value here is not just "this
  // row predates the field" (though that is the only way it arises today -
  // see the GeoNames migration ADR/rollout): it specifically means "this
  // row's location has never been resolved to one exact, verified GeoNames
  // place." There is deliberately no backfill for existing rows (matching
  // them to a real geonameId from a bare `country`/`city` string cannot be
  // done unambiguously after the fact - the very problem `geonameId`
  // exists to solve) - the next time such a row is edited, the full-replace
  // update schema requires a real `geonameId` the same as creation does,
  // so the caller must pick the city again through the search endpoint.
  @Property({ nullable: true })
  geonameId: number | null = null;

  // Whether users can join this Group without admin approval.
  // true  → auto-join (Membership or MEMBER Role created immediately on "join").
  // false → "join" creates a JOIN_REQUEST that must be approved.
  // Defaults to true (open/public) to match the historical visibility=PUBLIC default.
  @Property()
  isPublic: boolean = true;

  // Whether this Group is discoverable via the regular search
  // and listings.  Hidden resources are still reachable via direct link,
  // publicCode, or QR code.
  @Property()
  isHidden: boolean = false;

  // Whether ordinary MEMBERs of this Group may create Invitations on behalf
  // of the Group.  When false, only ADMIN and OWNER may invite.
  @Property()
  memberInvitesAllowed: boolean = false;

  // Globally-unique, immutable, human-readable code for locating this Group
  // without knowing its UUID.  Generated once at creation and never changed.
  // Not a secret - do NOT use it as an authorization token.
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
