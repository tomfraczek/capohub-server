import { GroupUserRefDto } from '../../groups/dto/group-user-ref.dto';
import { MembershipRequestTarget } from '../../groups/enums/membership-request-target.enum';
import { AnnouncementRecipientType } from '../enums/announcement-recipient-type.enum';

// Used for both the list and the detail endpoint - Announcements carry no
// separate summary shape (same reasoning as EventResponseDto's own
// comment): plain text, no rich content large enough to warrant hiding
// `body` from the list.
export interface AnnouncementResponseDto {
  id: string;
  communityGroupId: string;
  // Whether communityGroupId is a root Group or a Section - reused from
  // MembershipRequestTarget rather than a new enum (same GROUP/SECTION
  // distinction that type already carries). Lets a caller build the
  // correct /groups/:id/... vs /sections/:id/... route without depending
  // on recipientType, which can legitimately be RECIPIENT_GROUP and so
  // cannot answer this question by itself.
  communityResourceType: MembershipRequestTarget;
  // Where this Announcement comes from, for display - the owning Group's or
  // Section's own name, plus (for a Section, or a Group attached under
  // another Group) its parent Group's name, `null` when it has none (e.g. a
  // standalone Section).
  communityName: string;
  parentGroupName: string | null;
  title: string;
  body: string;
  author: GroupUserRefDto | null;
  recipientType: AnnouncementRecipientType;
  // Only non-null when recipientType === RECIPIENT_GROUP.
  recipientGroupId: string | null;
  isPinned: boolean;
  isImportant: boolean;
  // Computed from `expiresAt` at read time, never stored (task
  // requirement - no cron job just to flip a status column).
  isActive: boolean;
  expiresAt: string;
  // = createdAt (see announcement.entity.ts - there is no separate draft
  // state, so creation and publication are the same moment).
  publishedAt: string;
  // Set only by a real content edit through PATCH (title/body/isPinned/
  // expiresAt) - `null` means "never edited since publish". A stored
  // field on the entity, not derived from createdAt/updatedAt (updatedAt
  // is a generic technical timestamp bumped by any change for any reason,
  // including ones that aren't a content edit - see announcement.entity.ts).
  editedAt: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}
