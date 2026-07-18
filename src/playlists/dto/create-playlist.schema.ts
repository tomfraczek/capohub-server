import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const NAME_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 2000;

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX_LENGTH)
    .nullable()
    .default(null),
});

export class CreatePlaylistDto extends createZodDto(createPlaylistSchema) {}

export type CreatePlaylistInput = z.infer<typeof createPlaylistSchema>;
