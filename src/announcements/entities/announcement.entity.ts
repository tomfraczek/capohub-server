import {
  Check,
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Group } from '../../groups/entities/group.entity';
import { Section } from '../../groups/entities/section.entity';
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
// *is* the publish timestamp (see announcement.mapper.ts).
//
// No stored "active"/"archived" status either - task explicitly forbids a
// cron job just to flip a status once `expiresAt` passes; active-vs-
// archived is always computed from `expiresAt` at query/read time (see
// AnnouncementsService). `deletedAt`, below, is a separate, orthogonal
// concept from both of these - see its own comment.
//
// The composite index below matches the one and only sort order every
// list-shaped query uses (isPinned desc, createdAt desc - see
// AnnouncementsService.runList/listForViewer) - declared here, as an
// entity-level index, rather than only as a hand-written migration
// statement, so MikroORM's own schema diffing always agrees this index is
// supposed to exist (a raw-SQL-only index with no matching decorator gets
// silently dropped by the next `migration:create` run). Its leading column
// (isPinned) already serves any query that would otherwise want a
// standalone index on `isPinned` alone (confirmed via EXPLAIN ANALYZE
// against a 125k-row synthetic dataset: `isPinned` is never filtered
// without either this same order or a `community`/cross-community scope
// already driving the plan) - see isPinned's own comment below.
@Entity({ tableName: 'announcements' })
@Index({ properties: ['isPinned', 'createdAt'] })
// Exactly one of `communityGroup`/`communitySection` must be set, never
// both, never neither - mirrored here so migration:create/schema:update
// know this constraint is intentional and never propose dropping it. Name
// matches the constraint the migration creates verbatim - see
// Migration20260802100200_AddPolymorphicCommunityReferences.
@Check<Announcement>({
  name: 'announcements_community_group_or_section_check',
  expression: (columns) =>
    `("${columns.communityGroup}" is not null and "${columns.communitySection}" is null) or ("${columns.communityGroup}" is null and "${columns.communitySection}" is not null)`,
})
export class Announcement extends BaseEntity {
  // The Group-or-Section this Announcement belongs to, represented by two
  // nullable FKs (exactly one set) since the Group/Section physical split -
  // see GroupHierarchyService.findCommunityById for resolving whichever one
  // is populated.
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  communityGroup: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'no action' })
  communitySection: Section | null = null;

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
  // Recipient Group (RECIPIENT_GROUP), never changed by update(). No index
  // here - only ever queried via `!= 'RECIPIENT_GROUP'` (an inequality a
  // btree index cannot use) or, in the RECIPIENT_GROUP branch, alongside an
  // `id IN (...)` list that already dominates the plan; confirmed via
  // EXPLAIN ANALYZE (125k rows, 200-id realistic snapshot) that
  // `announcements_recipient_type_index` was never chosen (0 idx_scan).
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
  // a plain boolean, not a position/order. No standalone index here - the
  // class-level composite index above (isPinned, createdAt) already covers
  // `isPinned` alone as its leading column, so a second, single-column
  // index would only duplicate storage/write cost with zero query benefit.
  @Property()
  isPinned: boolean = false;

  // Drives NotificationType.IMPORTANT_ANNOUNCEMENT_PUBLISHED vs
  // .ANNOUNCEMENT_PUBLISHED (see AnnouncementsService.create) - push is
  // sent by default for an important Announcement regardless of the
  // recipient's general pushCommunity preference would otherwise suggest,
  // still subject to the master pushEnabled switch and device capability
  // (see NotificationPushService). Settable only by whoever already holds
  // ANNOUNCEMENT_MANAGE (OWNER/ADMIN - see group-role-permissions.map.ts),
  // the same guard create()/update() already require - no separate
  // permission was added for this field.
  @Property()
  isImportant: boolean = false;

  // Required, always in the future at creation (see
  // create-announcement.schema.ts) - pinning does not exempt an
  // Announcement from expiring (task requirement). Governs *only* natural
  // expiry - never touched by delete (see `deletedAt` below) and never
  // "revived" by it either. No index - every real query already filters by
  // `community` (or a small cross-community id set) or is ordered by the
  // (isPinned, createdAt) composite above, either of which dominates the
  // plan before `expiresAt` would matter; confirmed via EXPLAIN ANALYZE
  // (125k rows) that `announcements_expires_at_index` was never chosen (0
  // idx_scan) across list/archive/Home/single-row lookups. No maintenance
  // job scans purely by `expiresAt` either (task explicitly forbids a
  // cron/background scan - see the comment above).
  @Property({ type: 'timestamptz' })
  expiresAt!: Date;

  // Soft-delete marker - `null` until DELETE .../announcements/:id is
  // called (see AnnouncementsService.remove), then set once and never
  // cleared (no undelete/restore endpoint - task scope). Deliberately a
  // separate concept from `expiresAt`: expiry is a passive, natural
  // end-of-life every Announcement eventually reaches on its own;
  // deletion is a deliberate, immediate withdrawal an Owner/Admin chooses.
  // A deleted Announcement is excluded from *every* read path - active
  // list, archive, GET /home, unreadCount, direct detail, mark-as-read -
  // never just downgraded to "archived" (see
  // AnnouncementsService.buildVisibilityFilter, the one shared place this
  // is enforced). No index - every real query filters `deletedAt IS NULL`,
  // the overwhelming-majority case (deletion is meant to stay the rare
  // exception, never the common state), which a btree index cannot help
  // exclude cheaply and Postgres correctly never chooses to use for it (0
  // idx_scan confirmed via EXPLAIN ANALYZE, 125k rows, ~5% deleted). There
  // is also no "list deleted Announcements" admin/trash view querying
  // `deletedAt IS NOT NULL` that would benefit from it (task scope - no
  // restore endpoint exists).
  @Property({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null = null;

  // Set only by a real content edit through PATCH (see
  // AnnouncementsService.update) - `null` on a freshly published
  // Announcement, and left untouched by every other mutation this entity
  // goes through (marking read, deleting). Deliberately not derived from
  // `updatedAt` (a technical bookkeeping field BaseEntity already bumps on
  // *any* change for *any* reason) - see update()'s own comment for the
  // no-op-PATCH rule this enables.
  @Property({ type: 'timestamptz', nullable: true })
  editedAt: Date | null = null;
}
