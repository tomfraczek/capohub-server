import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { assignableGroupRoleSchema } from './assignable-group-role.schema';

export const changeMemberRoleSchema = z.object({
  role: assignableGroupRoleSchema,
});

export class ChangeMemberRoleDto extends createZodDto(changeMemberRoleSchema) {}

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
