export interface CommunityNotificationSettingsResponseDto {
  communityId: string;
  newJoinRequests: boolean;
  joinRequestApproved: boolean;
  newInvitations: boolean;
  invitationAccepted: boolean;
  invitationRejected: boolean;
  roleChanges: boolean;
  transferOwnership: boolean;
  archived: boolean;
  restored: boolean;
  communityDeleted: boolean;
}
