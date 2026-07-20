// No physical deletion of academies - ARCHIVED is the terminal "removed"
// state, same soft-delete convention as GroupStatus (see ADR-007). Academy
// is not an organizational unit (ADR-012), so it has no READ_ONLY state -
// there is no membership/permission lifecycle to suspend, only "in use" or
// "retired".
export enum AcademyStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}
