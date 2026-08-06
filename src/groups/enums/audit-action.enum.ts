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

  // Hierarchy - Group <-> Group / Group <-> Section structural
  // relationships (see HierarchyInvitation and GroupHierarchyService).
  // Always logged under the *parent* Group whose child-set changed -
  // mirroring the CREATE_CHILD_GROUP precedent above - never under a
  // resolved root.
  INVITE_CHILD = 'INVITE_CHILD',
  ACCEPT_CHILD_INVITATION = 'ACCEPT_CHILD_INVITATION',
  REJECT_CHILD_INVITATION = 'REJECT_CHILD_INVITATION',
  CANCEL_CHILD_INVITATION = 'CANCEL_CHILD_INVITATION',
  ATTACH_CHILD = 'ATTACH_CHILD',
  DETACH_CHILD = 'DETACH_CHILD',
  MOVE_CHILD = 'MOVE_CHILD',

  // Graduation catalog (see graduation/entities and
  // GroupPermission.GRADUATION_SYSTEM_MANAGE). A user changing their own
  // rank is deliberately NOT logged here - see FormalRankService's own
  // comment: it is a profile operation, not a community action.
  CREATE_GRADUATION_SYSTEM = 'CREATE_GRADUATION_SYSTEM',
  UPDATE_GRADUATION_SYSTEM = 'UPDATE_GRADUATION_SYSTEM',
  CREATE_RANK = 'CREATE_RANK',
  UPDATE_RANK = 'UPDATE_RANK',
  REORDER_RANK = 'REORDER_RANK',
  ARCHIVE_RANK = 'ARCHIVE_RANK',
  RESTORE_RANK = 'RESTORE_RANK',

  // Formal rank correction workflow (see FormalRankCorrectionRequest) -
  // always logged under the exact Section the workflow belongs to, never
  // the parent Group (see the module spec). Submitting a correction is
  // logged even though it's the target user's own action, not an admin
  // action - it happens within a workflow the Section's administration
  // opened, so it belongs in that Section's own record (see
  // FormalRankCorrectionService.submit's own comment).
  REQUEST_FORMAL_RANK_CORRECTION = 'REQUEST_FORMAL_RANK_CORRECTION',
  SUBMIT_FORMAL_RANK_CORRECTION = 'SUBMIT_FORMAL_RANK_CORRECTION',
  APPROVE_FORMAL_RANK_CORRECTION = 'APPROVE_FORMAL_RANK_CORRECTION',
  REJECT_FORMAL_RANK_CORRECTION = 'REJECT_FORMAL_RANK_CORRECTION',
}
