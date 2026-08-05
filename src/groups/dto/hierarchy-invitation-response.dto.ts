import { HierarchyInvitationStatus } from '../enums/hierarchy-invitation-status.enum';
import { GroupUserRefDto } from './group-user-ref.dto';
import { HierarchyEntityRefDto } from './hierarchy-response.dto';

export interface HierarchyInvitationResponseDto {
  id: string;
  // Always type: 'GROUP' - only a Group may be the parent side of a
  // hierarchy relationship (Section can never have children).
  parentGroup: HierarchyEntityRefDto;
  target: HierarchyEntityRefDto;
  invitedBy: GroupUserRefDto | null;
  status: HierarchyInvitationStatus;
  createdAt: string;
  respondedAt: string | null;
  respondedBy: GroupUserRefDto | null;
}
