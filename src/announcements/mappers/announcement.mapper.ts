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
  const editedAt =
    announcement.updatedAt.getTime() !== announcement.createdAt.getTime()
      ? announcement.updatedAt.toISOString()
      : null;

  return {
    id: announcement.id,
    communityGroupId: announcement.community.id,
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
    isActive: isAnnouncementActive(announcement, now),
    expiresAt: announcement.expiresAt.toISOString(),
    publishedAt: announcement.createdAt.toISOString(),
    editedAt,
    isRead: readInfo.isRead,
    readAt: readInfo.readAt ? readInfo.readAt.toISOString() : null,
    createdAt: announcement.createdAt.toISOString(),
    updatedAt: announcement.updatedAt.toISOString(),
  };
}
