// Safe user reference - same minimal shape as RoleAssignmentResponseDto's
// user ref (see groups/dto/role-assignment-response.dto.ts): never exposes
// anything beyond what the existing User Profile privacy model already
// treats as always-visible (see the module spec §6 - "Nie ujawniaj danych
// osobowych ponad obecny model prywatności").
export interface TrainingUserRefDto {
  id: string;
  displayName: string;
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
