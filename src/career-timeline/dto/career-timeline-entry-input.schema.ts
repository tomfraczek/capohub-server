import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

// "occurredOn cannot be in the future" is validated in
// CareerTimelineEntriesService, not here - depends on "now" at write time,
// same reasoning as every other date-not-in-future check in this codebase
// (e.g. FormalRankService.setCurrent's startedOn check).
const careerTimelineEntryFields = {
  occurredOn: z.string().date('Must be a valid date (YYYY-MM-DD)'),
  title: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(MAX_TITLE_LENGTH, `Must be at most ${MAX_TITLE_LENGTH} characters`),
  description: optionalNullableText(MAX_DESCRIPTION_LENGTH),
};

export const createCareerTimelineEntrySchema = z.object(
  careerTimelineEntryFields,
);

export class CreateCareerTimelineEntryDto extends createZodDto(
  createCareerTimelineEntrySchema,
) {}

export type CreateCareerTimelineEntryInput = z.infer<
  typeof createCareerTimelineEntrySchema
>;

// Full replace, like CreateCustomUserRankDto (reused for both create and
// update on that singleton's PUT route) - every field is required in the
// body (no partial PATCH semantics), simpler than tracking which
// individual fields changed on a 3-field entity.
export const updateCareerTimelineEntrySchema = z.object(
  careerTimelineEntryFields,
);

export class UpdateCareerTimelineEntryDto extends createZodDto(
  updateCareerTimelineEntrySchema,
) {}

export type UpdateCareerTimelineEntryInput = z.infer<
  typeof updateCareerTimelineEntrySchema
>;
