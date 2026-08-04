import {
  Check,
  Entity,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';
import { Section } from './section.entity';

export const RECIPIENT_GROUPS_ACTIVE_NAME_UNIQUE_INDEX =
  'recipient_groups_community_name_active_unique';

// A manually-managed, named subset of one Group-or-Section's members, used
// only to target Announcements (see Announcement.recipientGroup) - never a
// Group, Section, or Cohort itself (Cohort divides a community's members
// for *management* convenience and has no notion of "who receives what"; a
// Recipient Group exists purely to name a communication audience, e.g.
// "Trenerzy", "Rodzice"). Belongs to exactly one Group-or-Section,
// represented by two nullable FKs (exactly one set) since the Group/Section
// physical split - same pattern as Academy/Cohort/Event.community - see
// GroupHierarchyService.findCommunityById for resolving whichever one is
// populated.
//
// Never physically deleted, even once no Announcement references it -
// `isActive: false` ("deactivated") is the only removal state, so it can
// keep appearing in the history of Announcements already published to it
// (see AnnouncementRecipient's own comment) while becoming unselectable for
// a *new* Announcement (see AnnouncementsService.create).
@Entity({ tableName: 'recipient_groups' })
@Unique({
  name: RECIPIENT_GROUPS_ACTIVE_NAME_UNIQUE_INDEX,
  properties: ['group', 'section', 'name'],
  // Case-insensitive per-community uniqueness among *active* Recipient
  // Groups only ("Trenerzy" and "trenerzy" in the same community must
  // collide, but only while both are active) - partial on
  // `is_active = true`, same `expression` escape hatch as RoleAssignment's
  // partial OWNER index (see role-assignment.entity.ts). `coalesce` folds
  // the two nullable community FKs into one comparison key, since exactly
  // one of them is ever set for a given row. Deliberately does NOT
  // constrain inactive rows at all - a deactivated Recipient Group is this
  // entity's only "removal" state (see the comment above), so a name it
  // once held must become free again for a brand new Recipient Group the
  // moment it's deactivated, without deleting or renaming the old,
  // historical row (task requirement).
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} (coalesce("${columns.group}", "${columns.section}"), lower("${columns.name}")) where ("${columns.isActive}" = true)`,
})
// Exactly one of `group`/`section` must be set, never both, never neither -
// mirrored here so migration:create/schema:update know this constraint is
// intentional and never propose dropping it. Name matches the constraint
// the migration creates verbatim - see
// Migration20260802100200_AddPolymorphicCommunityReferences.
@Check<RecipientGroup>({
  name: 'recipient_groups_group_or_section_check',
  expression: (columns) =>
    `("${columns.group}" is not null and "${columns.section}" is null) or ("${columns.group}" is null and "${columns.section}" is not null)`,
})
export class RecipientGroup extends BaseEntity {
  // No delete cascade - Group/Section rows are archived, never physically
  // deleted (ADR-007), so there is never a delete to cascade from.
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  group: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'no action' })
  section: Section | null = null;

  @Property({ length: 150 })
  name!: string;

  @Property()
  isActive: boolean = true;

  // Purely informational/audit - never checked to gate any operation, so a
  // deleted creator account must not block anything. `set null` rather
  // than cascade: the Recipient Group (and any Announcement history built
  // on it) must survive its creator's account being deleted (see
  // announcement.entity.ts's own "history must survive" reasoning).
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  createdBy: User | null = null;
}
