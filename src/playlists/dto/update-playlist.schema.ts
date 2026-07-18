import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const NAME_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 2000;

// Partial update - unlike Song's replace-all PATCH, only fields present in
// the body are touched (see PlaylistsService.update).
export const updatePlaylistSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH).optional(),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX_LENGTH)
    .nullable()
    .optional(),
});

export class UpdatePlaylistDto extends createZodDto(updatePlaylistSchema) {}

export type UpdatePlaylistInput = z.infer<typeof updatePlaylistSchema>;
