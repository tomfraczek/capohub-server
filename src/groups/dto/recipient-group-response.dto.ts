import { GroupUserRefDto } from './group-user-ref.dto';

// Used for both the list and the detail endpoint - Recipient Groups are
// small, manually-curated lists (see recipient-group.entity.ts), never
// large enough to need a separate summary shape without `members` (same
// reasoning as EventResponseDto's own comment).
export interface RecipientGroupResponseDto {
  id: string;
  groupId: string;
  name: string;
  isActive: boolean;
  members: GroupUserRefDto[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
