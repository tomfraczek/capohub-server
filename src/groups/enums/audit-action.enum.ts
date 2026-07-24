// The fixed set of actions the Community Audit Log records (see
// AuditLogService and organization-domain.md#auditability). Deliberately
// one enum with one list endpoint (GET /groups/:groupId/audit-log),
// never a dedicated endpoint per action - see AuditLogController.
//
// Every value here corresponds to an existing, already-implemented mutation
// somewhere in the Groups module; this enum does not invent new business
// behavior, it only names what is logged.
export enum AuditAction {
  CREATE_COMMUNITY = 'CREATE_COMMUNITY',
  UPDATE_COMMUNITY = 'UPDATE_COMMUNITY',
  ARCHIVE = 'ARCHIVE',
  RESTORE = 'RESTORE',
  DELETE = 'DELETE',
  CREATE_CHILD_GROUP = 'CREATE_CHILD_GROUP',
  TRANSFER_OWNERSHIP = 'TRANSFER_OWNERSHIP',
  INVITE_MEMBER = 'INVITE_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
  DECLINE_INVITATION = 'DECLINE_INVITATION',
  JOIN_REQUEST = 'JOIN_REQUEST',
  APPROVE_JOIN_REQUEST = 'APPROVE_JOIN_REQUEST',
  REJECT_JOIN_REQUEST = 'REJECT_JOIN_REQUEST',
  ADD_ROLE = 'ADD_ROLE',
  REMOVE_ROLE = 'REMOVE_ROLE',
  REMOVE_MEMBER = 'REMOVE_MEMBER',
  LEAVE_COMMUNITY = 'LEAVE_COMMUNITY',
  BAN = 'BAN',
  UNBAN = 'UNBAN',
  SUSPEND = 'SUSPEND',
  UNSUSPEND = 'UNSUSPEND',
}
