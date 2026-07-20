// Minimal, embeddable reference to a Section a Membership is assigned to.
// Mirrors GroupUserRefDto's minimalism - id plus the one human-readable
// field a caller needs, not the full SectionResponseDto.
export interface MembershipSectionRefDto {
  id: string;
  name: string;
}
