import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';

export const RECIPIENT_GROUPS_NAME_UNIQUE_INDEX =
  'recipient_groups_group_id_name_unique';

// A manually-managed, named subset of one Group-or-Section's members, used
// only to target Announcements (see Announcement.recipientGroup) - never a
// Group, Section, or Cohort itself (Cohort divides a Group's members for
// *management* convenience and has no notion of "who receives what"; a
// Recipient Group exists purely to name a communication audience, e.g.
// "Trenerzy", "Rodzice"). Belongs to exactly one Group-kind entity (a Root
// Group or a Section) - same single-FK pattern as Academy/Cohort/
// Event.community (no separate resourceType discriminator: a Section is a
// Group row, not a distinct type - ADR-001).
//
// Never physically deleted, even once no Announcement references it -
// `isActive: false` ("deactivated") is the only removal state, so it can
// keep appearing in the history of Announcements already published to it
// (see AnnouncementRecipient's own comment) while becoming unselectable for
// a *new* Announcement (see AnnouncementsService.create).
@Entity({ tableName: 'recipient_groups' })
@Unique({
  name: RECIPIENT_GROUPS_NAME_UNIQUE_INDEX,
  properties: ['group', 'name'],
  // Case-insensitive per-Group uniqueness ("Trenerzy" and "trenerzy" in the
  // same Group must collide) - a plain @Unique() only compares raw column
  // values, so this needs the same `expression` escape hatch used by
  // RoleAssignment's partial OWNER index (see role-assignment.entity.ts):
  // an index on lower(name) instead of name itself.
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.group}", lower("${columns.name}"))`,
})
export class RecipientGroup extends BaseEntity {
  // No delete cascade - Group/Section rows are archived, never physically
  // deleted (ADR-007), so there is never a delete to cascade from.
  @Index()
  @ManyToOne(() => Group)
  group!: Group;

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
