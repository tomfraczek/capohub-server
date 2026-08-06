import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';

// awardedByName is normalized the same way as elsewhere (nullish/blank ->
// null). `null` after normalization means "no correction proposed to
// awardedByName" - FormalRankCorrectionService.approve only overwrites the
// assignment's awardedByName when this is non-null (see the module spec,
// rule "awardedByName pozostaje bez zmian, chyba że... jawnie poda
// poprawioną wartość" - a deliberate reading that providing a corrected
// value means a non-empty string, not an explicit-clear signal; this
// workflow cannot be used to blank out an existing awardedByName).
export const submitFormalRankCorrectionSchema = z.object({
  rankId: uuidSchema,
  awardedByName: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .nullish()
    .transform((value) => (value ? value : null)),
});

export class SubmitFormalRankCorrectionDto extends createZodDto(
  submitFormalRankCorrectionSchema,
) {}

export type SubmitFormalRankCorrectionInput = z.infer<
  typeof submitFormalRankCorrectionSchema
>;
