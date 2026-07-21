import { z } from 'zod';
import { GroupRole } from '../enums/group-role.enum';

// OWNER is deliberately excluded: it can only be granted through
// POST /groups/:id/transfer-ownership (GroupMembershipsService.transferOwnership),
// which enforces the "exactly one active OWNER" invariant (also backed by
// ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX at the database level). Reused by
// add-member and create/change-role-assignment so none of those endpoints
// can be used to create a second owner.
export const assignableGroupRoleSchema = z.enum([
  GroupRole.ADMIN,
  GroupRole.INSTRUCTOR,
  GroupRole.ASSISTANT,
  GroupRole.MEMBER,
]);
