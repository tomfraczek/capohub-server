import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';

// POST /sections/:sectionId/metronome-sequences - the caller's own
// sequences to add to this Section's library. Only adds: unlike
// PUT /metronome-sequences/:id/sections it never withdraws a share made
// elsewhere, so a stale view in the app can't undo a newer change.
export const addSectionMetronomeSequencesSchema = z.object({
  sequenceIds: z
    .array(uuidSchema)
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
});

export class AddSectionMetronomeSequencesDto extends createZodDto(
  addSectionMetronomeSequencesSchema,
) {}
