import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';

// PUT /metronome-sequences/:id/sections - the complete set of Sections the
// sequence should be shared in (an empty list withdraws every share).
export const shareMetronomeSequenceSchema = z.object({
  sectionIds: z
    .array(uuidSchema)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
});

export class ShareMetronomeSequenceDto extends createZodDto(
  shareMetronomeSequenceSchema,
) {}

export type ShareMetronomeSequenceInput = z.infer<
  typeof shareMetronomeSequenceSchema
>;
