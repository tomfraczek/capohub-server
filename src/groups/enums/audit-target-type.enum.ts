// What kind of entity `AuditLogEntry.targetId` refers to - lets API
// consumers resolve/link the target without guessing from the action alone
// (e.g. ADD_ROLE and REMOVE_ROLE both target a USER, but BAN's targetId is
// also a USER even though the underlying row that changed is a
// GroupMembership/GroupBan - the *conceptual* target is always the person
// affected, since that is what an admin reading the log cares about).
export enum AuditTargetType {
  COMMUNITY = 'COMMUNITY',
  USER = 'USER',
  ROLE_ASSIGNMENT = 'ROLE_ASSIGNMENT',
  MEMBERSHIP_REQUEST = 'MEMBERSHIP_REQUEST',
  HIERARCHY_INVITATION = 'HIERARCHY_INVITATION',
}
