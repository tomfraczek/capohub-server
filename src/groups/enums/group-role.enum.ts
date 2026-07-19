// Per-group role, held by a GroupMembership - fully independent from
// GlobalRole (see global-role.enum.ts). A user can hold a different
// GroupRole in every group they belong to.
//
// INSTRUCTOR and ASSISTANT carry no extra permissions yet (see
// group-role-permissions.map.ts) - they exist as data now so future stages
// (training/attendance) can key off them without a migration. There is no
// "Parent" role here; the parent-child relationship is a separate future
// module.
export enum GroupRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  INSTRUCTOR = 'INSTRUCTOR',
  ASSISTANT = 'ASSISTANT',
  MEMBER = 'MEMBER',
}
