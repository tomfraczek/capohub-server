import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { assignableGroupRoleSchema } from './assignable-group-role.schema';

// .strict() rejects unknown fields (e.g. an attempt to change rootGroupId)
// with 400 VALIDATION_ERROR instead of silently ignoring them - Membership's
// rootGroup is immutable after creation (see GroupMembership entity), same
// convention as updateGroupSchema's parentGroupId immutability.
export const changeMemberRoleSchema = z
  .object({
    role: assignableGroupRoleSchema,
  })
  .strict();

export class ChangeMemberRoleDto extends createZodDto(changeMemberRoleSchema) {}

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
