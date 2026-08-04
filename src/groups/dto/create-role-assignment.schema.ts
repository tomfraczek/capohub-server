import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import {
  assignableGroupRoleSchema,
  assignableSectionRoleSchema,
} from './assignable-group-role.schema';

// userId, not membershipId: RoleAssignment has no membership relation at
// all (see role-assignment.entity.ts) - a Role is granted directly to a
// user for a target. Two variants so an invalid role for the target kind
// is rejected at request-validation time, not only by the service/DB
// constraint.
export const createGroupRoleAssignmentSchema = z.object({
  userId: uuidSchema,
  role: assignableGroupRoleSchema,
});

export class CreateGroupRoleAssignmentDto extends createZodDto(
  createGroupRoleAssignmentSchema,
) {}

export type CreateGroupRoleAssignmentInput = z.infer<
  typeof createGroupRoleAssignmentSchema
>;

export const createSectionRoleAssignmentSchema = z.object({
  userId: uuidSchema,
  role: assignableSectionRoleSchema,
});

export class CreateSectionRoleAssignmentDto extends createZodDto(
  createSectionRoleAssignmentSchema,
) {}

export type CreateSectionRoleAssignmentInput = z.infer<
  typeof createSectionRoleAssignmentSchema
>;

export type CreateRoleAssignmentInput =
  CreateGroupRoleAssignmentInput | CreateSectionRoleAssignmentInput;
