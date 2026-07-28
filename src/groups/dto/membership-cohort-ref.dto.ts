// Minimal, embeddable reference to a Cohort a Membership is assigned to.
// Mirrors GroupUserRefDto's minimalism - id plus the one human-readable
// field a caller needs, not the full CohortResponseDto.
export interface MembershipCohortRefDto {
  id: string;
  name: string;
}
