import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createSongSchema } from './create-song.schema';

// PATCH /songs/:id takes the same full target structure as POST /songs (see
// createSongSchema) and replaces every child collection wholesale - there is
// no partial/diff update. A separate schema would be identical field-for-
// field, so we reuse createSongSchema directly rather than duplicating it.
export const updateSongSchema = createSongSchema;

export class UpdateSongDto extends createZodDto(updateSongSchema) {}

export type UpdateSongInput = z.infer<typeof updateSongSchema>;
