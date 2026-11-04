import { AvatarType } from '../../users/enums/avatar-type.enum';
import { UserGender } from '../../users/enums/user-gender.enum';
// Safe user reference - same minimal shape as RoleAssignmentResponseDto's
// user ref (see groups/dto/role-assignment-response.dto.ts): never exposes
// anything beyond what the existing User Profile privacy model already
// treats as always-visible (see the module spec §6 - "Nie ujawniaj danych
// osobowych ponad obecny model prywatności").
export interface TrainingUserRefDto {
  id: string;
  displayName: string;
  // For inflecting Polish wording about this user - see UserGender.
  gender: UserGender | null;
}

// Mirrors User.avatarType/avatarUrl/presetAvatarId rather than collapsing to
// a single URL - a PRESET avatar has none; same shape as
// EventOrganizerUserImageDto.
export interface TrainingTrainerImageDto {
  type: AvatarType;
  url: string | null;
  presetAvatarId: string | null;
}

// The trainer is shown as a profile card (Training/TrainingSeries
// "Prowadzący"), so unlike a plain TrainingUserRefDto it carries the avatar.
export interface TrainingTrainerRefDto extends TrainingUserRefDto {
  image: TrainingTrainerImageDto;
}

// Minimal Section reference embedded in Training/TrainingSeries responses -
// a Training always belongs to exactly one Section (never a Group - see
// training.entity.ts), so unlike EventCommunityRefDto this has no
// isRootGroup discriminant to carry.
export interface TrainingSectionRefDto {
  id: string;
  name: string;
  logoUrl: string | null;
}
