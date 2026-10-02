// GET /users/search - a minimal result shape for picking a
// user from outside any Section (e.g. Trainings' external-trainer picker).
// Deliberately does NOT reuse PublicUserProfileResponseDto: that DTO exposes
// sections/formalGroup/capoeiraStartedAt, which this generic picker has no
// business returning. `displayName` here is computed the same way as
// PublicUserProfileResponseDto's (see users/display-name.util.ts).
export interface UserSearchResultDto {
  id: string;
  displayName: string;
  numericCode?: string;
}

// Same limit/offset + items/total/hasMore convention as
// recipient-group-eligible-members and events/announcements list endpoints.
export interface UserSearchListResponseDto {
  items: UserSearchResultDto[];
  total: number;
  hasMore: boolean;
}
