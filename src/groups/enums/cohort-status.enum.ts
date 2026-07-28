// Same soft-delete convention as GroupStatus/AcademyStatus (see ADR-007). A
// Cohort has no members/permissions of its own (ADR-003), so - like
// Academy - it has no READ_ONLY state.
export enum CohortStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}
