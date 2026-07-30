import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Group } from '../../groups/entities/group.entity';
import { RecipientGroup } from '../../groups/entities/recipient-group.entity';
import { User } from '../../users/entities/user.entity';
import { AnnouncementRecipientType } from '../enums/announcement-recipient-type.enum';

// An official, one-way community message - no comments, reactions,
// attachments, rich text/HTML/Markdown, version history, or drafts (task
// scope). `body` is always plain text.
//
// Belongs to exactly one Group-kind entity (a Root Group or a Section) -
// same single-FK pattern as Academy/Cohort/Event.community, no separate
// resourceType discriminator (a Section is a Group row - ADR-001). This is
// also the community GroupPermissionsGuard authorizes create/edit/pin/
// delete/archive-view against (see AnnouncementsController).
//
// No separate `publishedAt`/draft state: there is no draft concept here
// (task scope), so publication always happens at creation - `createdAt`
// *is* the publish timestamp (see announcement.mapper.ts). Likewise no
// separate `editedAt` column - `updatedAt` (inherited from BaseEntity,
// bumped on every field change) already answers "was this ever edited"
// exactly (updatedAt !== createdAt), so the mapper derives `editedAt` from
// it rather than storing a redundant timestamp.
//
// No stored "active"/"archived" status either - task explicitly forbids a
// cron job just to flip a status once `expiresAt` passes; active-vs-
// archived is always computed from `expiresAt` at query/read time (see
// AnnouncementsService).
@Entity({ tableName: 'announcements' })
export class Announcement extends BaseEntity {
  @Index()
  @ManyToOne(() => Group)
  community!: Group;

  // Purely informational/audit (byline) - never checked to gate any
  // operation, so a deleted author account must not block anything.
  // `set null` rather than cascade: the Announcement itself is never
  // physically deleted (see AnnouncementsService.remove) and must survive
  // its author's account being deleted, same reasoning as
  // RecipientGroup.createdBy.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  author: User | null = null;

  @Property({ length: 200 })
  title!: string;

  @Property({ type: 'text' })
  body!: string;

  // Immutable after creation (task requirement: "odbiorca po publikacji
  // jest niezmienny") - resolved once at create time from the route's
  // community (GROUP/SECTION) or the caller's chosen, then-active
  // Recipient Group (RECIPIENT_GROUP), never changed by update().
  @Index()
  @Enum({ items: () => Object.values(AnnouncementRecipientType) })
  recipientType!: AnnouncementRecipientType;

  // Set only when recipientType === RECIPIENT_GROUP - the Recipient Group
  // itself, kept for reference/display. The actual, immutable audience is
  // the snapshot (see AnnouncementRecipient), never re-derived from this
  // relation's *current* members.
  @Index()
  @ManyToOne(() => RecipientGroup, { nullable: true })
  recipientGroup: RecipientGroup | null = null;

  // Any number of Announcements may be pinned at once (task requirement) -
  // a plain boolean, not a position/order.
  @Index()
  @Property()
  isPinned: boolean = false;

  // Required, always in the future at creation (see
  // create-announcement.schema.ts) - pinning does not exempt an
  // Announcement from expiring (task requirement).
  @Index()
  @Property({ type: 'timestamptz' })
  expiresAt!: Date;
}
