// No physical deletion of groups at the row level (ADR-007) - ARCHIVED and
// DELETED are both soft, non-physical states. ARCHIVED is the *reversible*
// "removed" state (Unarchive brings it back to ACTIVE). DELETED is a
// separate, *irreversible* sink state, added for the "permanently delete a
// Community" capability (see ADR-029) - once DELETED, a Group can never
// transition to any other status again; there is no "restore from deleted".
// This keeps ADR-007's historical-integrity guarantee (the row and every
// reference to it - Memberships, RoleAssignments, MembershipRequests,
// AuditLogEntries - stay intact) while still giving admins a genuinely
// final action distinct from the already-reversible Archive.
//
// READ_ONLY sits between ACTIVE and ARCHIVED: the group is still visible and
// informationally active, but every write is blocked (see
// group-write-policy.ts). Allowed transitions are enforced centrally by
// GroupPermissionsGuard via each endpoint's @AllowGroupStatuses(...) -
// see groups.controller.ts:
//   ACTIVE <-> READ_ONLY, ACTIVE -> ARCHIVED, READ_ONLY -> ARCHIVED,
//   ARCHIVED -> ACTIVE, ACTIVE -> DELETED, READ_ONLY -> DELETED,
//   ARCHIVED -> DELETED. ARCHIVED -> READ_ONLY and anything -> * out of
//   DELETED are deliberately not supported.
export enum GroupStatus {
  ACTIVE = 'ACTIVE',
  READ_ONLY = 'READ_ONLY',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED',
}
