import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import { RankTrack } from '../enums/rank-track.enum';
import { cordSegmentsSchema } from './cord-segment.schema';

const DESCRIPTION_MAX_LENGTH = 2000;

export const createCustomUserRankSchema = z.object({
  name: z.string().trim().min(1, 'Must not be empty').max(150),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
  track: z.nativeEnum(RankTrack),
  cordSegments: cordSegmentsSchema,
  // Since when the user holds this rank (YYYY-MM-DD, optional, never in
  // the future - checked in CustomUserRankService).
  startedOn: z.string().date('Must be a valid date (YYYY-MM-DD)').optional(),
});

export class CreateCustomUserRankDto extends createZodDto(
  createCustomUserRankSchema,
) {}

export type CreateCustomUserRankInput = z.infer<
  typeof createCustomUserRankSchema
>;
