import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalTrimmedStringQuerySchema } from '../../common/validation/query.schemas';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

// No pagination - the rhythm catalogue is small and curated by CMS (spec
// section 8/15).
export const rhythmListQuerySchema = z.object({
  search: optionalTrimmedStringQuerySchema,
  instrumentId: uuidSchema.optional(),
});

export class RhythmListQueryDto extends createZodDto(rhythmListQuerySchema) {}

export type RhythmListQuery = z.infer<typeof rhythmListQuerySchema>;
