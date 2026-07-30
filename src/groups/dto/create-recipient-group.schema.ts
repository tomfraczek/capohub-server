import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

// Full member list, not an incremental add/remove - same "full replace on
// write" convention as update-group.schema.ts/update-cohort.schema.ts.
// Each id is validated as an in-scope community member by
// RecipientGroupsService (see RoleAssignmentsService.isCommunityMember) -
// never by this schema, which only checks shape (unique, well-formed
// UUIDs).
export const createRecipientGroupSchema = z.object({
  name: z.string().trim().min(1).max(150),
  memberUserIds: z
    .array(uuidSchema)
    .default([])
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'memberUserIds must not contain duplicates',
    ),
});

export class CreateRecipientGroupDto extends createZodDto(
  createRecipientGroupSchema,
) {}

export type CreateRecipientGroupInput = z.infer<
  typeof createRecipientGroupSchema
>;
