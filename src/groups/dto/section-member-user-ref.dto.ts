import { UserGender } from '../../users/enums/user-gender.enum';
import { AvatarType } from '../../users/enums/avatar-type.enum';
import { GroupUserRefDto } from './group-user-ref.dto';

// Mirrors User.avatarType/avatarUrl/presetAvatarId (see user.entity.ts) the
// same way EventOrganizerUserImageDto does - a PRESET avatar has no URL at
// all, the app resolves `presetAvatarId` to a local asset itself.
export interface SectionMemberUserImageDto {
  type: AvatarType;
  url: string | null;
  presetAvatarId: string | null;
}

// SectionMembershipResponseDto's own `user` - GroupUserRefDto plus the
// avatar, so the members list/preview can show a profile photo. Its own
// type rather than an extra field on GroupUserRefDto, which would silently
// change every unrelated response embedding that ref (see
// RecipientGroupEligibleMemberDto's identical reasoning). Still never
// carries email, clerkUserId or globalRole.
export interface SectionMemberUserRefDto extends GroupUserRefDto {
  image: SectionMemberUserImageDto;
  // For inflecting Polish wording about this user - see UserGender.
  gender: UserGender | null;
}
