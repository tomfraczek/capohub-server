import { GroupUserRefDto } from '../../groups/dto/group-user-ref.dto';
import { AnnouncementRecipientType } from '../enums/announcement-recipient-type.enum';

// Used for both the list and the detail endpoint - Announcements carry no
// separate summary shape (same reasoning as EventResponseDto's own
// comment): plain text, no rich content large enough to warrant hiding
// `body` from the list.
export interface AnnouncementResponseDto {
  id: string;
  communityGroupId: string;
  title: string;
  body: string;
  author: GroupUserRefDto | null;
  recipientType: AnnouncementRecipientType;
  // Only non-null when recipientType === RECIPIENT_GROUP.
  recipientGroupId: string | null;
  isPinned: boolean;
  // Computed from `expiresAt` at read time, never stored (task
  // requirement - no cron job just to flip a status column).
  isActive: boolean;
  expiresAt: string;
  // = createdAt (see announcement.entity.ts - there is no separate draft
  // state, so creation and publication are the same moment).
  publishedAt: string;
  // = updatedAt, but only when it actually differs from createdAt - `null`
  // means "never edited since publish". Named explicitly rather than
  // leaving the frontend to compare createdAt/updatedAt itself.
  editedAt: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}
