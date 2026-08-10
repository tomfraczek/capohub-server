// Deliberately minimal - unlike CommunityNotificationSettingsResponseDto
// (Section), a Group has no join/invite workflow (see
// MembershipRequestsService.groupHasNoMembership) so none of the five
// membership-workflow toggles apply, and the other five (roleChanges/
// transferOwnership/archived/restored/communityDeleted) are not consulted
// by any delivery decision yet for either community kind - copying them
// onto the Group shape would only be speculative. `muted` is the one field
// that actually does something for a Group today (see
// NotificationPushService).
export interface GroupNotificationSettingsResponseDto {
  communityId: string;
  muted: boolean;
}
