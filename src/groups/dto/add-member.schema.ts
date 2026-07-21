import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { assignableGroupRoleSchema } from './assignable-group-role.schema';

// Technical add only - no invitation/acceptance flow yet (spec section
// "Dodanie członka"). userId must reference an existing app user;
// GroupMembershipsService validates that and rejects duplicates (a second
// ACTIVE membership for the same user in the same group).
//
// `role` is deliberately optional: Membership represents only "does this
// User belong to this organization" and never creates a Role Assignment
// by itself (see ADR-028/ADR-004) - a Membership with zero Role
// Assignments (belongs to the organization, not yet assigned to any
// Group) is a valid, supported state. Omitting `role` creates only the
// Membership. Providing it additionally grants that Role for the Root
// Group itself, through the same "first Role in a Group grants MEMBER
// too" mechanism used everywhere else (see
// RoleAssignmentsService.ensureMemberRole) - the Root Group is not a
// special case.
export const addMemberSchema = z
  .object({
    userId: uuidSchema,
    role: assignableGroupRoleSchema.optional(),
  })
  .strict();

export class AddMemberDto extends createZodDto(addMemberSchema) {}

export type AddMemberInput = z.infer<typeof addMemberSchema>;
