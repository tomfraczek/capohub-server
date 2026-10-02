import {
  Collection,
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { CommunityListVisibility } from '../enums/community-list-visibility.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { Section } from './section.entity';

// Group is an organizational container - a distinct, physically-stored
// entity type, never a Section in disguise (see the Group/Section
// physical-split ADR, stage 1 of the organizational-domain rebuild). A
// Group never holds ordinary members directly (that remains
// GroupMembership's concern, scoped to a Root Group - unchanged by this
// split); it exists purely to model the hierarchy: it may have at most one
// parent Group, any number of child Groups, and any number of Sections.
//
// Only GroupHierarchyService may mutate `parentGroup` (attach/detach), so
// cycle-freedom and every other hierarchy rule stay centrally enforced and
// are never duplicated in a controller. No delete cascade: a Group is
// archived, never physically deleted, so a parent row is never removed out
// from under its children.
//
// Deliberately has no location fields (country/city/region/geonameId) -
// those live on Section only, since a Group is an organizational umbrella
// that may span many places (or none), while a Section always operates in
// one specific place.
//
// Also deliberately has no timezone/currencyCode (unlike Section, which
// still has its own) - those are set once, per-User, from the owner's own
// profile settings (see users/entities/user.entity.ts) rather than
// per-Group. See create-group.schema.ts for the request-shape side of this.
@Entity({ tableName: 'groups' })
export class Group extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  parentGroup: Group | null = null;

  @OneToMany(() => Group, (group) => group.parentGroup)
  childGroups = new Collection<Group>(this);

  @OneToMany(() => Section, (section) => section.parentGroup)
  sections = new Collection<Section>(this);

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  // Legacy URL field - still settable via PATCH /groups/:id (see
  // update-group.schema.ts) and still rendered whenever profileImageKey is
  // unset, but no longer the source of truth once an R2 profile image has
  // been uploaded (see storage/image-url.util.ts's resolveImageUrl) -
  // cleared to null the moment that first upload happens (see
  // GroupsService.uploadProfileImage), so the two fields never disagree
  // about which is authoritative.
  @Property({ nullable: true, length: 2048 })
  logoUrl: string | null = null;

  // Same legacy-URL-vs-R2-key relationship as logoUrl/profileImageKey
  // above, just for the cover image - see GroupsService.uploadCoverImage.
  // Cleared to null the moment the first R2 cover upload happens.
  @Property({ nullable: true, length: 2048 })
  coverImageUrl: string | null = null;

  // R2 object key ("groups/{id}/profile/{uuid}.webp" - see
  // storage/object-keys.util.ts) for this Group's uploaded profile image;
  // null until the first upload. See logoUrl's own comment above for how
  // the two fields relate.
  @Property({ nullable: true, length: 512 })
  profileImageKey: string | null = null;

  // R2 object key ("groups/{id}/cover/{uuid}.webp") for this Group's
  // uploaded cover image; null until the first upload. See
  // coverImageUrl's own comment above for how the two fields relate.
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

  // Whether users can join this Group without admin approval.
  // true  → auto-join (Membership or MEMBER Role created immediately on "join").
  // false → "join" creates a JOIN_REQUEST that must be approved.
  @Property()
  isPublic: boolean = true;

  // Whether this Group is discoverable via the regular search
  // and listings. Hidden resources are still reachable via direct link,
  // publicCode, or QR code.
  @Property()
  isHidden: boolean = false;

  // Whether ordinary MEMBERs of this Group may create Invitations on behalf
  // of the Group. When false, only ADMIN and OWNER may invite.
  @Property()
  memberInvitesAllowed: boolean = false;

  // Who besides the Group's OWNER/ADMIN may see its followers list - see
  // community-list-visibility.enum.ts.
  @Enum({ items: () => Object.values(CommunityListVisibility) })
  followersVisibility: CommunityListVisibility = CommunityListVisibility.PUBLIC;

  // Globally-unique, immutable, human-readable code for locating this Group
  // without knowing its UUID. Generated once at creation (see
  // GroupsService.create/generateUniquePublicCode) and never changed - the
  // DB column has always been NOT NULL (see
  // Migration20260721_AddPublicCodeAndMembershipRequests); `nullable: true`
  // here was metadata drift against that, not an intentional relaxation.
  // Not a secret - do NOT use it as an authorization token.
  @Unique()
  @Property({ length: 15 })
  publicCode!: string;

  @Index()
  @Enum({ items: () => Object.values(GroupStatus) })
  status: GroupStatus = GroupStatus.ACTIVE;

  // Trustworthy, permanent record of who founded this Group and when -
  // set exactly once, atomically with the Group row itself, in
  // GroupsService.create, and never touched again by anything (not
  // RoleAssignmentsService.transferOwnership, not GroupsService.update -
  // `applyFields` never assigns it). Deliberately NOT re-derived from
  // RoleAssignment at read time any more: a real founder's RoleAssignment
  // row can be *physically deleted* if they later transfer ownership away
  // and then delete their CapoHub account (UserService.deleteLocalAccountData
  // hard-deletes every RoleAssignment for the deleted user) - re-deriving
  // "founder" from the earliest-surviving OWNER RoleAssignment would then
  // silently misattribute founding to whoever the ownership was
  // transferred to. `founderUser` survives that entirely, because nothing
  // ever deletes it - the FK's own `set null` on the founder's account
  // deletion clears only the *relation* (see below), never this row's
  // memory that a founding happened.
  //
  // `createdAt` (BaseEntity) doubles as the founding date: Group and its
  // founder's OWNER RoleAssignment are created in the same transaction
  // (see GroupsService.create), so there is no separate `foundedAt` field -
  // introducing one would just duplicate an already-reliable timestamp.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  founderUser: User | null = null;

  // Snapshot of the founder's User.displayName *at founding time* (kept in
  // sync with any later profile rename per this same reasoning: this
  // column is never touched again after creation, so a later rename does
  // not retroactively rewrite the timeline card - same "snapshot, not
  // live join" precedent as CareerTimelineEntry's own group/section
  // snapshots). Deliberately the one field that survives the founder's own
  // account deletion intact: `founderUser` goes null (FK `set null`), but
  // this string stays, so "founded by <name>" never regresses to
  // "founded by nobody" just because the founder is no longer a CapoHub
  // user.
  @Property({ length: 100, nullable: true })
  founderNameSnapshot: string | null = null;
}
