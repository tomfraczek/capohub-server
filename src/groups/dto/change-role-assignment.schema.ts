import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { assignableGroupRoleSchema } from './assignable-group-role.schema';

// .strict() rejects unknown fields (e.g. an attempt to change groupId or
// membershipId) with 400 VALIDATION_ERROR instead of silently ignoring
// them - a RoleAssignment's Group and Membership are immutable after
// creation (see RoleAssignment entity); only `role` may be replaced.
export const changeRoleAssignmentSchema = z
  .object({
    role: assignableGroupRoleSchema,
  })
  .strict();

export class ChangeRoleAssignmentDto extends createZodDto(
  changeRoleAssignmentSchema,
) {}

export type ChangeRoleAssignmentInput = z.infer<
  typeof changeRoleAssignmentSchema
>;
