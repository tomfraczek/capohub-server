import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { Group } from '../groups/entities/group.entity';
import { RecipientGroupsService } from '../groups/recipient-groups.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { User } from '../users/entities/user.entity';
import { AnnouncementListQueryInput } from './dto/announcement-list-query.schema';
import { AnnouncementResponseDto } from './dto/announcement-response.dto';
import { CreateAnnouncementInput } from './dto/create-announcement.schema';
import { UpdateAnnouncementInput } from './dto/update-announcement.schema';
import { AnnouncementRecipient } from './entities/announcement-recipient.entity';
import { AnnouncementRead } from './entities/announcement-read.entity';
import { Announcement } from './entities/announcement.entity';
import { AnnouncementRecipientType } from './enums/announcement-recipient-type.enum';
import { PUSH_NOTIFICATION_PORT } from './integration/push-notification.port';
import type { PushNotificationPort } from './integration/push-notification.port';
import { toAnnouncementResponseDto } from './mappers/announcement.mapper';

export interface AnnouncementListResult {
  items: AnnouncementResponseDto[];
  total: number;
  hasMore: boolean;
}

// A concrete (spreadable) object type for buildViewerFilter's community
// scope - one exact community, or a set of them for the cross-community
// Home feed (see listForViewer).
type CommunityScope = { community: string } | { community: { $in: string[] } };

// Announcement existence/status of its *Group* is already enforced by
// GroupPermissionsGuard (via :groupId/:sectionId) before any handler here
// runs, same convention as RecipientGroupsService/AcademiesService. This
// service additionally resolves: which of the three recipient shapes an
// Announcement targets, the immutable Recipient Group snapshot, and every
// viewer's isRead/readAt - none of which the guard has any visibility into.
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly em: EntityManager,
    private readonly recipientGroupsService: RecipientGroupsService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    @Inject(PUSH_NOTIFICATION_PORT)
    private readonly pushNotificationPort: PushNotificationPort,
  ) {}

  async create(
    communityGroupId: string,
    input: CreateAnnouncementInput,
    author: User,
  ): Promise<AnnouncementResponseDto> {
    const announcement = await this.em.transactional(async (em) => {
      const community = await em.findOne(Group, { id: communityGroupId });
      if (!community) {
        throw this.communityNotFound();
      }

      const created = new Announcement();
      created.community = community;
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
        created.recipientType =
          community.parentGroup === null
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

    // Push is deliberately sent after the transaction above has already
    // committed - a send failure (or the current NullPushNotificationService
    // sending nothing at all - see push-notification.port.ts) must never
    // roll back an otherwise-successful publish (task requirement).
    if (input.sendPushNotification) {
      await this.sendPushForAnnouncement(announcement, author.id);
    }

    return toAnnouncementResponseDto(announcement, {
      isRead: false,
      readAt: null,
    });
  }

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
    announcement.title = input.title;
    announcement.body = input.body;
    announcement.isPinned = input.isPinned;
    announcement.expiresAt = new Date(input.expiresAt);
    await this.em.flush();

    const readInfo = await this.resolveReadInfo(
      this.em,
      viewer.id,
      announcement.id,
    );
    return toAnnouncementResponseDto(announcement, readInfo);
  }

  /**
   * Soft delete - never a physical row removal (this codebase has no
   * physical-delete convention for any similar resource - Group/Academy/
   * Cohort/Event are all archived, never dropped - ADR-007). Reuses the
   * exact same "active iff expiresAt is in the future" rule already built
   * for natural expiry (see announcement.mapper.ts) rather than adding a
   * second, parallel "deleted" flag/column: forcing `expiresAt` into the
   * past immediately and irreversibly retires the Announcement from every
   * active list while leaving it fully intact in the archive, which is
   * exactly the required behavior (see task's "Wygasanie i archiwum").
   */
  async remove(
    communityGroupId: string,
    announcementId: string,
  ): Promise<void> {
    const announcement = await this.loadOrFail(
      this.em,
      communityGroupId,
      announcementId,
    );
    if (announcement.expiresAt.getTime() > Date.now()) {
      announcement.expiresAt = new Date(Date.now() - 1000);
      await this.em.flush();
    }
  }

  async list(
    communityGroupId: string,
    viewer: User,
    query: AnnouncementListQueryInput,
  ): Promise<AnnouncementListResult> {
    const where = await this.buildViewerFilter(
      this.em,
      viewer.id,
      { community: communityGroupId },
      { activeOnly: true },
    );

    return this.runList(communityGroupId, viewer, where, query);
  }

  /**
   * OWNER/ADMIN-only oversight view of every expired Announcement under
   * this community - deliberately *not* filtered by Recipient Group
   * snapshot the way list()/getById() are: an administrator reviewing the
   * community's own history is not "a recipient" looking something up for
   * themselves, the same oversight-vs-recipient split already established
   * by EVENT_VIEW_ALL/EVENT_MODERATE over Event's own Owner/Organizer tier.
   */
  async archive(
    communityGroupId: string,
    viewer: User,
    query: AnnouncementListQueryInput,
  ): Promise<AnnouncementListResult> {
    const where: FilterQuery<Announcement> = {
      community: communityGroupId,
      expiresAt: { $lte: new Date() },
    };
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
    if (
      announcement.recipientType === AnnouncementRecipientType.RECIPIENT_GROUP
    ) {
      const inSnapshot = await this.em.findOne(AnnouncementRecipient, {
        announcement: announcementId,
        user: viewer.id,
      });
      if (!inSnapshot) {
        throw this.announcementNotFound();
      }
    }

    const readInfo = await this.resolveReadInfo(
      this.em,
      viewer.id,
      announcementId,
    );
    return toAnnouncementResponseDto(announcement, readInfo);
  }

  /**
   * Idempotent - see AnnouncementRead's own comment. Re-verifies the same
   * Recipient Group snapshot rule as getById first, so marking-as-read can
   * never confirm an Announcement's existence to someone who isn't
   * actually one of its recipients.
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
    if (
      announcement.recipientType === AnnouncementRecipientType.RECIPIENT_GROUP
    ) {
      const inSnapshot = await this.em.findOne(AnnouncementRecipient, {
        announcement: announcementId,
        user: viewer.id,
      });
      if (!inSnapshot) {
        throw this.announcementNotFound();
      }
    }

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
   * Cross-community "everything I can see" feed - backs GET /home (see
   * HomeService), never its own HTTP endpoint (Home is its only caller).
   * Reuses exactly the same per-Announcement visibility rule as list()
   * (active-only, Recipient Group snapshot filter) resolved across every
   * Group/Section the viewer currently holds any Role Assignment for -
   * mirrors EventsService.listForViewer's own "one shared viewer-scope
   * resolution, reused instead of duplicated" approach.
   */
  async listForViewer(
    viewer: User,
    limit: number,
  ): Promise<{ items: AnnouncementResponseDto[]; unreadCount: number }> {
    const communityIds =
      await this.roleAssignmentsService.getCommunityIdsWithAnyRole(viewer.id);
    if (communityIds.length === 0) {
      return { items: [], unreadCount: 0 };
    }

    const where = await this.buildViewerFilter(
      this.em,
      viewer.id,
      { community: { $in: communityIds } },
      { activeOnly: true },
    );

    const [matching, page] = await Promise.all([
      this.em.find(Announcement, where, { fields: ['id'] }),
      this.em.find(Announcement, where, {
        populate: ['community', 'author', 'recipientGroup'],
        orderBy: { isPinned: 'desc', createdAt: 'desc' },
        limit,
      }),
    ]);

    const matchingIds = matching.map((row) => row.id);
    const readCount =
      matchingIds.length === 0
        ? 0
        : await this.em.count(AnnouncementRead, {
            user: viewer.id,
            announcement: { $in: matchingIds },
          });

    const readInfoByAnnouncementId = await this.resolveReadInfoBatch(
      this.em,
      viewer.id,
      page.map((row) => row.id),
    );
    const items = page.map((row) =>
      toAnnouncementResponseDto(
        row,
        readInfoByAnnouncementId.get(row.id) ?? { isRead: false, readAt: null },
      ),
    );

    return {
      items,
      unreadCount: matchingIds.length - readCount,
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
      const readIds = await this.readAnnouncementIdsForCommunity(
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
        populate: ['community', 'author', 'recipientGroup'],
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
   * The shared active-Announcement, viewer-visible filter used by list()
   * and listForViewer(): always excludes RECIPIENT_GROUP-type rows the
   * viewer's own snapshot doesn't include, scoped to `communityFilter`
   * (one exact community, or a set of them for the cross-community feed).
   */
  private async buildViewerFilter(
    em: EntityManager,
    viewerId: string,
    communityFilter: CommunityScope,
    options: { activeOnly: boolean },
  ): Promise<FilterQuery<Announcement>> {
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

    return {
      ...communityFilter,
      ...(options.activeOnly ? { expiresAt: { $gt: new Date() } } : {}),
      $or: recipientOr,
    };
  }

  private async readAnnouncementIdsForCommunity(
    em: EntityManager,
    viewerId: string,
    communityGroupId: string,
  ): Promise<string[]> {
    const rows = await em.find(AnnouncementRead, {
      user: viewerId,
      announcement: { community: communityGroupId },
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
    return { isRead: read !== null, readAt: read?.createdAt ?? null };
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
        readAt: read.createdAt,
      });
    }
    return result;
  }

  /**
   * Resolves every user this specific, just-published Announcement should
   * push to right now (task requirement - never the author, never a user
   * who no longer has access), deduplicated. For RECIPIENT_GROUP, re-checks
   * each snapshotted user's *current* community access - unlike the
   * snapshot-based read-path check above, push proactively reaches out to
   * many users at once, none of whom have had their own access freshly
   * proven by a guard the way a single request's viewer has.
   */
  private async sendPushForAnnouncement(
    announcement: Announcement,
    authorId: string,
  ): Promise<void> {
    let recipientUserIds: string[];
    if (
      announcement.recipientType === AnnouncementRecipientType.RECIPIENT_GROUP
    ) {
      const snapshotRows = await this.em.find(AnnouncementRecipient, {
        announcement: announcement.id,
      });
      const stillMember = await Promise.all(
        snapshotRows.map((row) =>
          this.roleAssignmentsService.isCommunityMember(
            announcement.community.id,
            row.user.id,
          ),
        ),
      );
      recipientUserIds = snapshotRows
        .filter((_, index) => stillMember[index])
        .map((row) => row.user.id);
    } else {
      recipientUserIds =
        await this.roleAssignmentsService.listCommunityMemberUserIds(
          announcement.community.id,
        );
    }

    const dedupedRecipients = [...new Set(recipientUserIds)].filter(
      (userId) => userId !== authorId,
    );
    if (dedupedRecipients.length === 0) {
      return;
    }

    await this.pushNotificationPort.sendToUsers(dedupedRecipients, {
      title: announcement.title,
      body: announcement.body,
    });
  }

  private async loadOrFail(
    em: EntityManager,
    communityGroupId: string,
    announcementId: string,
  ): Promise<Announcement> {
    const announcement = await em.findOne(
      Announcement,
      { id: announcementId, community: communityGroupId },
      { populate: ['community', 'author', 'recipientGroup'] },
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
