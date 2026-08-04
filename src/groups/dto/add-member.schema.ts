import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { assignableSectionRoleSchema } from './assignable-group-role.schema';

// Technical add only - no invitation/acceptance flow yet. userId must
// reference an existing app user; SectionMembershipsService validates that
// and rejects duplicates (a second ACTIVE membership for the same user in
// the same section).
//
// Every add always creates the SectionMembership *and* its base MEMBER
// Role Assignment together, atomically - a Section membership never exists
// without MEMBER (see role-assignment.entity.ts / SectionMembershipsService).
// `role` is optional and, if provided (and not MEMBER itself, which would
// be a no-op), grants that *additional* Role alongside MEMBER in the same
// transaction.
export const addMemberSchema = z
  .object({
    userId: uuidSchema,
    role: assignableSectionRoleSchema.optional(),
  })
  .strict();

export class AddMemberDto extends createZodDto(addMemberSchema) {}

export type AddMemberInput = z.infer<typeof addMemberSchema>;
