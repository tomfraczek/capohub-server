import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

export const addPlaylistSongSchema = z.object({
  songId: z.string().uuid(),
});

export class AddPlaylistSongDto extends createZodDto(addPlaylistSongSchema) {}

export type AddPlaylistSongInput = z.infer<typeof addPlaylistSongSchema>;
