import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createRhythmSchema } from './create-rhythm.schema';

// PATCH /admin/rhythms/:id takes the same full target structure as
// POST /admin/rhythms and replaces every field/child collection wholesale -
// media, instrumentLinks and songLinks are all full replace-all lists, not
// partial diffs (mirrors update-song.schema.ts / update-instrument.schema.ts).
// As with Instrument, omitting `slug` keeps the existing one instead of
// deriving a new one from `name`.
export const updateRhythmSchema = createRhythmSchema;

export class UpdateRhythmDto extends createZodDto(updateRhythmSchema) {}

export type UpdateRhythmInput = z.infer<typeof updateRhythmSchema>;
