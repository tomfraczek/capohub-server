import { MembershipRequestStatus } from '../enums/membership-request-status.enum';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';
import { MembershipRequestType } from '../enums/membership-request-type.enum';
import { SectionMemberUserImageDto } from './section-member-user-ref.dto';

export interface MembershipRequestUserRefDto {
  id: string;
  displayName: string;
}

// The requester/inviter - additionally carries what a reviewer needs to
// recognise them in "Prośby o dołączenie" (avatar, apelido). Basic identity
// only, same as GroupAudienceMemberDto's user - never email/clerkUserId.
export interface MembershipRequestInitiatorDto extends MembershipRequestUserRefDto {
  apelido: string | null;
  image: SectionMemberUserImageDto;
}

export interface MembershipRequestResponseDto {
  id: string;
  type: MembershipRequestType;
  targetType: MembershipRequestTarget;
  targetGroupId: string;
  status: MembershipRequestStatus;
  initiatedBy: MembershipRequestInitiatorDto;
  // Present for INVITATION rows where the invitee already had an account
  invitedUser: MembershipRequestUserRefDto | null;
  // Present for INVITATION rows where the invitee was identified by email
  invitedEmail: string | null;
  processedAt: string | null;
  processedBy: MembershipRequestUserRefDto | null;
  createdAt: string;
  updatedAt: string;
}
