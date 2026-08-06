import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';

const REASON_MAX_LENGTH = 2000;

export const createFormalRankCorrectionSchema = z.object({
  targetUserId: uuidSchema,
  reason: optionalNullableText(REASON_MAX_LENGTH),
});

export class CreateFormalRankCorrectionDto extends createZodDto(
  createFormalRankCorrectionSchema,
) {}

export type CreateFormalRankCorrectionInput = z.infer<
  typeof createFormalRankCorrectionSchema
>;
