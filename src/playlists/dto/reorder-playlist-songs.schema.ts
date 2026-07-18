import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// Full reordering, not a patch - songIds must be exactly the set of songs
// currently in the playlist (see PlaylistsService.reorderSongs).
export const reorderPlaylistSongsSchema = z.object({
  songIds: z.array(z.string().uuid()).min(1),
});

export class ReorderPlaylistSongsDto extends createZodDto(
  reorderPlaylistSongsSchema,
) {}

export type ReorderPlaylistSongsInput = z.infer<
  typeof reorderPlaylistSongsSchema
>;
