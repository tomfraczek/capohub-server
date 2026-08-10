import { Group } from '../../groups/entities/group.entity';
import { MembershipRequestTarget } from '../../groups/enums/membership-request-target.enum';
import { announcementCommunity } from '../announcement-community.util';
import { Announcement } from '../entities/announcement.entity';
import { AnnouncementResponseDto } from '../dto/announcement-response.dto';

export function isAnnouncementActive(
  announcement: Announcement,
  now: Date = new Date(),
): boolean {
  return announcement.expiresAt.getTime() > now.getTime();
}

export function toAnnouncementResponseDto(
  announcement: Announcement,
  readInfo: { isRead: boolean; readAt: Date | null },
  now: Date = new Date(),
): AnnouncementResponseDto {
  const community = announcementCommunity(announcement);
  return {
    id: announcement.id,
    communityGroupId: community.id,
    // Type-based, not a `parentGroup === null` check - see the
    // organizational-domain rebuild, stage 1.
    communityResourceType:
      community instanceof Group && community.parentGroup === null
        ? MembershipRequestTarget.GROUP
        : MembershipRequestTarget.SECTION,
    title: announcement.title,
    body: announcement.body,
    author: announcement.author
      ? {
          id: announcement.author.id,
          displayName: announcement.author.displayName,
        }
      : null,
    recipientType: announcement.recipientType,
    recipientGroupId: announcement.recipientGroup?.id ?? null,
    isPinned: announcement.isPinned,
    isImportant: announcement.isImportant,
    isActive: isAnnouncementActive(announcement, now),
    expiresAt: announcement.expiresAt.toISOString(),
    publishedAt: announcement.createdAt.toISOString(),
    editedAt: announcement.editedAt
      ? announcement.editedAt.toISOString()
      : null,
    isRead: readInfo.isRead,
    readAt: readInfo.readAt ? readInfo.readAt.toISOString() : null,
    createdAt: announcement.createdAt.toISOString(),
    updatedAt: announcement.updatedAt.toISOString(),
  };
}
