import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import { RankTrack } from '../enums/rank-track.enum';
import { cordSegmentsSchema } from './cord-segment.schema';

const DESCRIPTION_MAX_LENGTH = 2000;

export const createRankSchema = z.object({
  track: z.nativeEnum(RankTrack),
  name: z.string().trim().min(1, 'Must not be empty').max(150),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
  // null / omitted both mean "this is the first rank of its track" - see
  // rank.entity.ts.
  previousRankId: uuidSchema
    .nullish()
    .transform((value) => (value ? value : null)),
  // Full replace - see rank-cord-segment.entity.ts.
  cordSegments: cordSegmentsSchema,
});

export class CreateRankDto extends createZodDto(createRankSchema) {}

export type CreateRankInput = z.infer<typeof createRankSchema>;
