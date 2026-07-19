import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { assignableGroupRoleSchema } from './assignable-group-role.schema';

// Technical add only - no invitation/acceptance flow yet (spec section
// "Dodanie członka"). userId must reference an existing app user;
// GroupMembershipsService validates that and rejects duplicates (a second
// ACTIVE membership for the same user in the same group).
export const addMemberSchema = z.object({
  userId: uuidSchema,
  role: assignableGroupRoleSchema,
});

export class AddMemberDto extends createZodDto(addMemberSchema) {}

export type AddMemberInput = z.infer<typeof addMemberSchema>;
