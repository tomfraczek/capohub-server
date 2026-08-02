import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { Group } from '../groups/entities/group.entity';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { RecipientGroupsService } from '../groups/recipient-groups.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { User } from '../users/entities/user.entity';
import { assignAnnouncementCommunity } from './announcement-community.util';
import { AnnouncementListQueryInput } from './dto/announcement-list-query.schema';
import { AnnouncementResponseDto } from './dto/announcement-response.dto';
import { CreateAnnouncementInput } from './dto/create-announcement.schema';
import { UpdateAnnouncementInput } from './dto/update-announcement.schema';
import { AnnouncementRecipient } from './entities/announcement-recipient.entity';
import { AnnouncementRead } from './entities/announcement-read.entity';
import { Announcement } from './entities/announcement.entity';
import { AnnouncementRecipientType } from './enums/announcement-recipient-type.enum';
import {
  isAnnouncementActive,
  toAnnouncementResponseDto,
} from './mappers/announcement.mapper';

export interface AnnouncementListResult {
  items: AnnouncementResponseDto[];
  total: number;
  hasMore: boolean;
}

const COMMUNITY_POPULATE = ['communityGroup', 'communitySection'] as const;

// A concrete (spreadable) object type for buildVisibilityFilter's community
// scope - one exact community, or a set of them for the cross-community
// Home feed (see listForViewer). Matches against whichever of
// communityGroup/communitySection is actually set (see
// announcement.entity.ts).
type CommunityScope = {
  $or: [
    { communityGroup: string | { $in: string[] } },
    { communitySection: string | { $in: string[] } },
  ];
};

function communityScopeFilter(idOrIds: string | string[]): CommunityScope {
  const value = Array.isArray(idOrIds) ? { $in: idOrIds } : idOrIds;
  return { $or: [{ communityGroup: value }, { communitySection: value }] };
}

// Announcement existence/status of its *Group* is already enforced by
// GroupPermissionsGuard (via :groupId/:sectionId) before any handler here
// runs, same convention as RecipientGroupsService/AcademiesService. This
// service additionally resolves: which of the three recipient shapes an
// Announcement targets, the immutable Recipient Group snapshot, every
// viewer's isRead/readAt, and its own lifecycle (natural expiry vs
// deliberate deletion - see announcement.entity.ts) - none of which the
// guard has any visibility into.
//
// buildVisibilityFilter() is the single shared source of truth for "which
// Announcements can this query even consider" - every read path (list,
// archive, the cross-community Home feed) builds its WHERE clause through
// it, so `deletedAt IS NULL`, the active/expired split, and the Recipient
// Group snapshot restriction are each expressed exactly once, never
// hand-copied. The two single-row paths (getById, markRead) instead load
// by id then run assertReadable() - the same underlying rules, applied to
// one already-loaded row instead of a query filter.
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly em: EntityManager,
    private readonly recipientGroupsService: RecipientGroupsService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  async create(
    communityGroupId: string,
    input: CreateAnnouncementInput,
    author: User,
  ): Promise<AnnouncementResponseDto> {
    const announcement = await this.em.transactional(async (em) => {
      const community = await this.groupHierarchyService.findCommunityById(
        communityGroupId,
        em,
      );
      if (!community) {
        throw this.communityNotFound();
      }

      const created = new Announcement();
      assignAnnouncementCommunity(created, community);
      created.author = author;
      created.title = input.title;
      created.body = input.body;
      created.isPinned = input.isPinned;
      created.expiresAt = new Date(input.expiresAt);

      if (input.recipientGroupId) {
        const recipientGroup =
          await this.recipientGroupsService.loadActiveForCommunity(
            communityGroupId,
            input.recipientGroupId,
          );
        created.recipientType = AnnouncementRecipientType.RECIPIENT_GROUP;
        created.recipientGroup = recipientGroup;
      } else {
        // Type-based, not a `parentGroup === null` check - see the
        // organizational-domain rebuild, stage 1.
        created.recipientType =
          community instanceof Group && community.parentGroup === null
            ? AnnouncementRecipientType.GROUP
            : AnnouncementRecipientType.SECTION;
      }

      await em.persist(created).flush();

      if (input.recipientGroupId) {
        const memberUserIds =
          await this.recipientGroupsService.listMemberUserIds(
            input.recipientGroupId,
          );
        for (const userId of memberUserIds) {
          const snapshotRow = new AnnouncementRecipient();
          snapshotRow.announcement = created;
          snapshotRow.user = em.getReference(User, userId);
          em.persist(snapshotRow);
        }
        await em.flush();
      }

      return created;
    });

    return toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });
  }

  /**
   * A no-op PATCH (every field sent equals the current value) never
   * touches the row at all - no write, no `updatedAt` bump, and certainly
   * no `editedAt` (task requirement). `editedAt` is set only when at least
   * one of title/body/isPinned/expiresAt actually changes - never derived
   * from `updatedAt` (see announcement.entity.ts).
   */
  async update(
    communityGroupId: string,
    announcementId: string,
    input: UpdateAnnouncementInput,
    viewer: User,
  ): Promise<AnnouncementResponseDto> {
    const announcement = await this.loadOrFail(
      this.em,
      communityGroupId,
      announcementId,
    );

    const newExpiresAt = new Date(input.expiresAt);
    const changed =
      announcement.title !== input.title ||
      announcement.body !== input.body ||
      announcement.isPinned !== input.isPinned ||
      announcement.expiresAt.getTime() !== newExpiresAt.getTime();

    if (changed) {
      announcement.title = input.title;
      announcement.body = input.body;
      announcement.isPinned = input.isPinned;
      announcement.expiresAt = newExpiresAt;
      announcement.editedAt = new Date();
      await this.em.flush();
    }

    const readInfo = await this.resolveReadInfo(
      this.em,
      viewer.id,
      announcement.id,
    );
    return toAnnouncementResponseDto(announcement, readInfo);
  }

  /**
   * Soft delete via a dedicated `deletedAt` marker - a deliberate,
   * immediate withdrawal, never expressed by touching `expiresAt` (that
   * field governs *only* natural expiry - see announcement.entity.ts).
   * Idempotent: this intentionally loads *without* the shared
   * deletedAt-excluding filter (see loadOrFail/buildVisibilityFilter), so
   * a second DELETE call finds the already-deleted row and simply no-ops
   * (204 either way) rather than 404ing or double-stamping `deletedAt`.
   * Pinning has no bearing here (task requirement - pinning never affects
   * deletion, exactly as it never affects expiry).
   */
  async remove(
    communityGroupId: string,
    announcementId: string,
  ): Promise<void> {
    const announcement = await this.em.findOne(Announcement, {
      id: announcementId,
      ...communityScopeFilter(communityGroupId),
    });
    if (!announcement) {
      throw this.announcementNotFound();
    }
    if (announcement.deletedAt === null) {
      announcement.deletedAt = new Date();
      await this.em.flush();
    }
  }

  async list(
    communityGroupId: string,
    viewer: User,
    query: AnnouncementListQueryInput,
  ): Promise<AnnouncementListResult> {
    const where = await this.buildVisibilityFilter(
      this.em,
      viewer.id,
      communityScopeFilter(communityGroupId),
      { expiry: 'active', restrictToRecipientSnapshot: true },
    );

    return this.runList(communityGroupId, viewer, where, query);
  }

  /**
   * OWNER/ADMIN-only oversight view of every expired (but not deleted)
   * Announcement under this community - deliberately *not* filtered by
   * Recipient Group snapshot the way list()/getById() are: an
   * administrator reviewing the community's own history is not "a
   * recipient" looking something up for themselves, the same
   * oversight-vs-recipient split already established by
   * EVENT_VIEW_ALL/EVENT_MODERATE over Event's own Owner/Organizer tier.
   * A deleted Announcement never appears here either (task requirement) -
   * this is the *expired* archive, not an undelete tool.
   */
  async archive(
    communityGroupId: string,
    viewer: User,
    query: AnnouncementListQueryInput,
  ): Promise<AnnouncementListResult> {
    const where = await this.buildVisibilityFilter(
      this.em,
      viewer.id,
      communityScopeFilter(communityGroupId),
      { expiry: 'archived', restrictToRecipientSnapshot: false },
    );

    return this.runList(communityGroupId, viewer, where, query);
  }

  async getById(
    communityGroupId: string,
    announcementId: string,
    viewer: User,
  ): Promise<AnnouncementResponseDto> {
    const announcement = await this.loadOrFail(
      this.em,
      communityGroupId,
      announcementId,
    );
    await this.assertReadable(communityGroupId, announcement, viewer);

    const readInfo = await this.resolveReadInfo(
      this.em,
      viewer.id,
      announcementId,
    );
    return toAnnouncementResponseDto(announcement, readInfo);
  }

  /**
   * Idempotent - see AnnouncementRead's own comment. Runs the exact same
   * assertReadable() check as getById first, so marking-as-read can never
   * confirm a deleted/inaccessible Announcement's existence, and a
   * naturally-expired one can only be marked read by a viewer who already
   * holds archive access to it (task requirement).
   */
  async markRead(
    communityGroupId: string,
    announcementId: string,
    viewer: User,
  ): Promise<void> {
    const announcement = await this.loadOrFail(
      this.em,
      communityGroupId,
      announcementId,
    );
    await this.assertReadable(communityGroupId, announcement, viewer);

    const existing = await this.em.findOne(AnnouncementRead, {
      announcement: announcementId,
      user: viewer.id,
    });
    if (existing) {
      return;
    }

    const read = new AnnouncementRead();
    read.announcement = this.em.getReference(Announcement, announcementId);
    read.user = viewer;
    read.readAt = new Date();
    try {
      await this.em.persist(read).flush();
    } catch (error) {
      // Race: another request (e.g. a second tap) recorded the read first -
      // idempotent means this is a success, not an error (task requirement).
      const raceRecord = await this.em.findOne(AnnouncementRead, {
        announcement: announcementId,
        user: viewer.id,
      });
      if (!raceRecord) {
        throw error;
      }
    }
  }

  /**
   * Cross-community "everything I can see" feed - backs both GET /home's
   * capped 3-item preview (HomeService) and GET /announcements, the
   * paginated "see all" screen the preview's "See all" affordance opens
   * (AnnouncementsGlobalController). One shared method rather than two
   * parallel implementations, so both keep exactly the same visibility
   * rule as list() (deletedAt IS NULL, active-only, Recipient Group
   * snapshot filter) resolved across every Group/Section the viewer
   * currently holds any Role Assignment for - mirrors
   * EventsService.listForViewer's own "one shared viewer-scope resolution"
   * approach.
   *
   * `total`/`hasMore` always describe the *entire* matching set (subject to
   * `unreadOnly`), never just the returned page - Home ignores them (its
   * own contract has no such fields) and the global endpoint relies on
   * them for pagination, same convention as runList().
   *
   * `includeUnreadCount` is opt-in: only Home needs the full unread count
   * alongside its 3-item page, and computing it costs an extra query, so
   * the global endpoint (which has no such field in its response) skips
   * it entirely rather than paying for a number nobody reads.
   */
  async listForViewer(
    viewer: User,
    options: {
      limit: number;
      offset?: number;
      unreadOnly?: boolean;
      includeUnreadCount?: boolean;
    },
  ): Promise<{
    items: AnnouncementResponseDto[];
    total: number;
    hasMore: boolean;
    unreadCount: number;
  }> {
    const offset = options.offset ?? 0;
    const communityIds =
      await this.roleAssignmentsService.getCommunityIdsWithAnyRole(viewer.id);
    if (communityIds.length === 0) {
      return { items: [], total: 0, hasMore: false, unreadCount: 0 };
    }

    const where = await this.buildVisibilityFilter(
      this.em,
      viewer.id,
      communityScopeFilter(communityIds),
      { expiry: 'active', restrictToRecipientSnapshot: true },
    );

    const needsReadIds = options.unreadOnly || options.includeUnreadCount;
    const readIds = needsReadIds
      ? await this.readAnnouncementIds(this.em, viewer.id, communityIds)
      : [];

    const unreadCount = options.includeUnreadCount
      ? await this.em.count(
          Announcement,
          readIds.length > 0
            ? { $and: [where, { id: { $nin: readIds } }] }
            : where,
        )
      : 0;

    const finalWhere =
      options.unreadOnly && readIds.length > 0
        ? { $and: [where, { id: { $nin: readIds } }] }
        : where;

    const [rows, total] = await this.em.findAndCount(Announcement, finalWhere, {
      populate: [...COMMUNITY_POPULATE, 'author', 'recipientGroup'],
      // `id` is a deterministic tie-breaker for rows sharing the same
      // isPinned/createdAt (e.g. bulk-created in the same transaction) -
      // without it, LIMIT/OFFSET pagination across two requests could
      // reorder or skip/duplicate a row when ties are broken arbitrarily.
      orderBy: { isPinned: 'desc', createdAt: 'desc', id: 'desc' },
      limit: options.limit,
      offset,
    });

    const readInfoByAnnouncementId = await this.resolveReadInfoBatch(
      this.em,
      viewer.id,
      rows.map((row) => row.id),
    );
    const items = rows.map((row) =>
      toAnnouncementResponseDto(
        row,
        readInfoByAnnouncementId.get(row.id) ?? { isRead: false, readAt: null },
      ),
    );

    return {
      items,
      total,
      hasMore: offset + items.length < total,
      unreadCount,
    };
  }

  private async runList(
    communityGroupId: string,
    viewer: User,
    where: FilterQuery<Announcement>,
    query: AnnouncementListQueryInput,
  ): Promise<AnnouncementListResult> {
    let finalWhere = where;

    if (query.unreadOnly) {
      const readIds = await this.readAnnouncementIds(
        this.em,
        viewer.id,
        communityGroupId,
      );
      finalWhere =
        readIds.length > 0
          ? { $and: [where, { id: { $nin: readIds } }] }
          : where;
    }

    const [items, total] = await this.em.findAndCount(
      Announcement,
      finalWhere,
      {
        populate: [...COMMUNITY_POPULATE, 'author', 'recipientGroup'],
        orderBy: { isPinned: 'desc', createdAt: 'desc' },
        limit: query.limit,
        offset: query.offset,
      },
    );

    const readInfoByAnnouncementId = await this.resolveReadInfoBatch(
      this.em,
      viewer.id,
      items.map((item) => item.id),
    );

    return {
      items: items.map((item) =>
        toAnnouncementResponseDto(
          item,
          readInfoByAnnouncementId.get(item.id) ?? {
            isRead: false,
            readAt: null,
          },
        ),
      ),
      total,
      hasMore: query.offset + items.length < total,
    };
  }

  /**
   * The single shared source of truth for "which Announcements can this
   * query even consider" - every list-shaped read path (list, archive, the
   * cross-community Home feed) builds its WHERE clause through this, so
   * none of them can drift from one another:
   *  - `deletedAt IS NULL` always, unconditionally - a deleted Announcement
   *    is invisible to every caller, including archive/oversight (task
   *    requirement).
   *  - `expiry: 'active'` (expiresAt > now) or `'archived'` (expiresAt <=
   *    now) - the two are mutually exclusive by construction, so an
   *    Announcement is always in exactly one of the two views.
   *  - `restrictToRecipientSnapshot` - true for a recipient's own view
   *    (list/Home: only RECIPIENT_GROUP-type rows this viewer's snapshot
   *    includes), false for the OWNER/ADMIN archive oversight view (every
   *    RECIPIENT_GROUP-type row is visible regardless of snapshot - see
   *    archive()'s own comment).
   */
  private async buildVisibilityFilter(
    em: EntityManager,
    viewerId: string,
    communityFilter: CommunityScope,
    options: {
      expiry: 'active' | 'archived';
      restrictToRecipientSnapshot: boolean;
    },
  ): Promise<FilterQuery<Announcement>> {
    const base: FilterQuery<Announcement> = {
      ...communityFilter,
      deletedAt: null,
      expiresAt:
        options.expiry === 'active'
          ? { $gt: new Date() }
          : { $lte: new Date() },
    };

    if (!options.restrictToRecipientSnapshot) {
      return base;
    }

    const recipientRows = await em.find(AnnouncementRecipient, {
      user: viewerId,
      announcement: communityFilter,
    });
    const recipientAnnouncementIds = recipientRows.map(
      (row) => row.announcement.id,
    );

    const recipientOr: FilterQuery<Announcement>[] = [
      { recipientType: { $ne: AnnouncementRecipientType.RECIPIENT_GROUP } },
    ];
    if (recipientAnnouncementIds.length > 0) {
      recipientOr.push({
        recipientType: AnnouncementRecipientType.RECIPIENT_GROUP,
        id: { $in: recipientAnnouncementIds },
      });
    }

    // `base` already carries its own `$or` (the community scope, from
    // `communityFilter`) - spreading a second `$or: recipientOr` in here
    // would silently clobber it instead of combining the two, so the two
    // `$or`s are ANDed together explicitly.
    return { $and: [base, { $or: recipientOr }] };
  }

  /**
   * Whether `viewer` may read this already-loaded (and already
   * not-deleted - see loadOrFail) Announcement, given its recipient scope
   * and current active/expired state:
   *  - Expired: viewer must hold ANNOUNCEMENT_ARCHIVE_VIEW for this exact
   *    community (task requirement - a plain member can never open an
   *    expired Announcement through the regular detail/mark-as-read
   *    endpoints, only through the OWNER/ADMIN archive). Holding it grants
   *    full oversight of *every* expired Announcement regardless of
   *    recipient type - the Recipient Group snapshot check below is
   *    skipped entirely, mirroring archive()'s own
   *    restrictToRecipientSnapshot: false (an administrator reviewing the
   *    community's history is not "a recipient" looking something up for
   *    themselves, so they must never be blocked from opening one just
   *    because they personally were never in its snapshot).
   *  - Active RECIPIENT_GROUP-type: viewer must be in the immutable
   *    snapshot - this is the normal, recipient-based visibility rule and
   *    is unaffected by archive access.
   * Throws 404 (never 403) on failure - consistent with
   * GroupPermissionsGuard's own "never confirm existence" convention.
   */
  private async assertReadable(
    communityGroupId: string,
    announcement: Announcement,
    viewer: User,
  ): Promise<void> {
    if (!isAnnouncementActive(announcement)) {
      const authorization =
        await this.roleAssignmentsService.resolveAuthorization(
          communityGroupId,
          viewer.id,
        );
      const roles = authorization?.roleAssignments.map((a) => a.role) ?? [];
      const hasArchiveAccess =
        authorization !== null &&
        this.groupPermissionService.hasAllPermissionsForRoles(
          roles,
          [GroupPermission.ANNOUNCEMENT_ARCHIVE_VIEW],
          authorization.membership.status,
        );
      if (!hasArchiveAccess) {
        throw this.announcementNotFound();
      }
      return;
    }

    if (
      announcement.recipientType === AnnouncementRecipientType.RECIPIENT_GROUP
    ) {
      const inSnapshot = await this.em.findOne(AnnouncementRecipient, {
        announcement: announcement.id,
        user: viewer.id,
      });
      if (!inSnapshot) {
        throw this.announcementNotFound();
      }
    }
  }

  /**
   * `communityScope` is a single community (the per-community list/archive)
   * or every community a viewer holds a Role in (the cross-community feed -
   * see listForViewer) - both call sites need the same thing: which
   * Announcements *this* viewer has already read, to drive `unreadOnly`/
   * `unreadCount`. Bounded by how much this one viewer has actually read,
   * not by the full Announcement table, so this stays cheap even across
   * many communities.
   */
  private async readAnnouncementIds(
    em: EntityManager,
    viewerId: string,
    communityScope: string | string[],
  ): Promise<string[]> {
    const rows = await em.find(AnnouncementRead, {
      user: viewerId,
      announcement: communityScopeFilter(communityScope),
    });
    return rows.map((row) => row.announcement.id);
  }

  private async resolveReadInfo(
    em: EntityManager,
    viewerId: string,
    announcementId: string,
  ): Promise<{ isRead: boolean; readAt: Date | null }> {
    const read = await em.findOne(AnnouncementRead, {
      user: viewerId,
      announcement: announcementId,
    });
    return { isRead: read !== null, readAt: read?.readAt ?? null };
  }

  private async resolveReadInfoBatch(
    em: EntityManager,
    viewerId: string,
    announcementIds: string[],
  ): Promise<Map<string, { isRead: boolean; readAt: Date | null }>> {
    if (announcementIds.length === 0) {
      return new Map();
    }
    const reads = await em.find(AnnouncementRead, {
      user: viewerId,
      announcement: { $in: announcementIds },
    });
    const result = new Map<string, { isRead: boolean; readAt: Date | null }>();
    for (const read of reads) {
      result.set(read.announcement.id, {
        isRead: true,
        readAt: read.readAt,
      });
    }
    return result;
  }

  /**
   * Loads a not-deleted Announcement for this exact community - used by
   * every path except remove() (which must still find an already-deleted
   * row too, to stay idempotent - see its own comment). `deletedAt: null`
   * here is what makes a deleted Announcement 404 from getById/update/
   * markRead exactly like a truly nonexistent one (task requirement).
   */
  private async loadOrFail(
    em: EntityManager,
    communityGroupId: string,
    announcementId: string,
  ): Promise<Announcement> {
    const announcement = await em.findOne(
      Announcement,
      {
        id: announcementId,
        ...communityScopeFilter(communityGroupId),
        deletedAt: null,
      },
      { populate: [...COMMUNITY_POPULATE, 'author', 'recipientGroup'] },
    );
    if (!announcement) {
      throw this.announcementNotFound();
    }
    return announcement;
  }

  private announcementNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'ANNOUNCEMENT_NOT_FOUND',
      message: 'Announcement not found',
    });
  }

  private communityNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
