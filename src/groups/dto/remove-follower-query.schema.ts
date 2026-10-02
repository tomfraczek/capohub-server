import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// DELETE /groups/:id/followers/:userId?block=true - `block` additionally
// records a GroupFollowBlock so the user can't follow again. Query string
// booleans arrive as text, so only the literal "true"/"false" are accepted.
export const removeFollowerQuerySchema = z
  .object({
    block: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

export class RemoveFollowerQueryDto extends createZodDto(
  removeFollowerQuerySchema,
) {}

export type RemoveFollowerQuery = z.infer<typeof removeFollowerQuerySchema>;
