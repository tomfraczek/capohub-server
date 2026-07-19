// No physical deletion of groups - ARCHIVED is the terminal "removed" state.
// READ_ONLY sits between ACTIVE and ARCHIVED: the group is still visible and
// informationally active, but every write is blocked (see
// group-write-policy.ts). Allowed transitions are enforced centrally by
// GroupPermissionsGuard via each endpoint's @AllowGroupStatuses(...) -
// see groups.controller.ts:
//   ACTIVE <-> READ_ONLY, ACTIVE -> ARCHIVED, READ_ONLY -> ARCHIVED,
//   ARCHIVED -> ACTIVE. ARCHIVED -> READ_ONLY is deliberately not supported.
export enum GroupStatus {
  ACTIVE = 'ACTIVE',
  READ_ONLY = 'READ_ONLY',
  ARCHIVED = 'ARCHIVED',
}
