import { z } from 'zod';
import { GroupRole } from '../enums/group-role.enum';

// OWNER is deliberately excluded: it can only be granted through
// POST /groups/:id/transfer-ownership (GroupMembershipsService.transferOwnership),
// which enforces the "exactly one active OWNER" invariant. Both
// add-member and change-member-role reuse this so neither endpoint can be
// used to create a second owner.
export const assignableGroupRoleSchema = z.enum([
  GroupRole.ADMIN,
  GroupRole.INSTRUCTOR,
  GroupRole.ASSISTANT,
  GroupRole.MEMBER,
]);
