import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { assignableGroupRoleSchema } from './assignable-group-role.schema';

// membershipId, not userId: a Role Assignment always references a
// Membership (see organization-entities.md#roleassignment) - the caller
// looks up the target member's Membership id via GET
// /groups/:rootGroupId/members first (the same Membership used across all
// of that user's Role Assignments in this organization). OWNER is
// deliberately excluded - see assignable-group-role.schema.ts.
export const createRoleAssignmentSchema = z.object({
  membershipId: uuidSchema,
  role: assignableGroupRoleSchema,
});

export class CreateRoleAssignmentDto extends createZodDto(
  createRoleAssignmentSchema,
) {}

export type CreateRoleAssignmentInput = z.infer<
  typeof createRoleAssignmentSchema
>;
