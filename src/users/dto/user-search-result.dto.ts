import { AvatarType } from '../enums/avatar-type.enum';

// GET /users/search - a minimal result shape for picking a
// user from outside any Section (e.g. Trainings' external-trainer picker).
// Deliberately does NOT reuse PublicUserProfileResponseDto: that DTO exposes
// sections/formalGroup/capoeiraStartedAt, which this generic picker has no
// business returning. `displayName` here is computed the same way as
// PublicUserProfileResponseDto's (see users/display-name.util.ts).
export interface UserSearchResultDto {
  id: string;
  displayName: string;
  // Shown under the name so a picker row looks like every other user row
  // (Group "Role" screen's admin picker). Basic identity - no privacy
  // toggle, same as firstName/lastName behind displayName.
  apelido: string | null;
  // Same shape as SectionMemberUserImageDto - a PRESET avatar has no URL,
  // the app resolves presetAvatarId to a local asset itself.
  image: {
    type: AvatarType;
    url: string | null;
    presetAvatarId: string | null;
  };
  numericCode?: string;
}

// Same limit/offset + items/total/hasMore convention as
// recipient-group-eligible-members and events/announcements list endpoints.
export interface UserSearchListResponseDto {
  items: UserSearchResultDto[];
  total: number;
  hasMore: boolean;
}
