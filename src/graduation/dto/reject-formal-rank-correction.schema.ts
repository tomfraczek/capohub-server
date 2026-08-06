import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';

const REJECTION_REASON_MAX_LENGTH = 2000;

export const rejectFormalRankCorrectionSchema = z.object({
  reason: optionalNullableText(REJECTION_REASON_MAX_LENGTH),
});

export class RejectFormalRankCorrectionDto extends createZodDto(
  rejectFormalRankCorrectionSchema,
) {}

export type RejectFormalRankCorrectionInput = z.infer<
  typeof rejectFormalRankCorrectionSchema
>;
