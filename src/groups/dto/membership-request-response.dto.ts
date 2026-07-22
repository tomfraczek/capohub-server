import { MembershipRequestStatus } from '../enums/membership-request-status.enum';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';
import { MembershipRequestType } from '../enums/membership-request-type.enum';

export interface MembershipRequestUserRefDto {
  id: string;
  displayName: string;
}

export interface MembershipRequestResponseDto {
  id: string;
  type: MembershipRequestType;
  targetType: MembershipRequestTarget;
  targetGroupId: string;
  status: MembershipRequestStatus;
  initiatedBy: MembershipRequestUserRefDto;
  // Present for INVITATION rows where the invitee already had an account
  invitedUser: MembershipRequestUserRefDto | null;
  // Present for INVITATION rows where the invitee was identified by email
  invitedEmail: string | null;
  processedAt: string | null;
  processedBy: MembershipRequestUserRefDto | null;
  createdAt: string;
  updatedAt: string;
}
