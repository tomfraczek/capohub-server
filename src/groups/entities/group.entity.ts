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

  // Globally-unique, immutable, human-readable code for locating this Group
  // without knowing its UUID. Generated once at creation and never changed.
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
