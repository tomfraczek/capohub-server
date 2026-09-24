import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const MAX_NAME_LENGTH = 100;

// firstName/lastName are business-required (see profileComplete) but
// deliberately never `.nullable()` here - PATCH is a partial update (the
// key may be omitted entirely, leaving the current value untouched), but
// once a name has been set it can never be cleared back to null through
// this endpoint. That asymmetry is what makes profileComplete monotonic.
const requiredNameSchema = z
  .string()
  .trim()
  .min(1, 'Must not be empty')
  .max(MAX_NAME_LENGTH, `Must be at most ${MAX_NAME_LENGTH} characters`)
  .optional();

const nullableTextSchema = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(maxLength, `Must be at most ${maxLength} characters`)
    .nullable()
    .optional();

const capoeiraStartedAtSchema = z
  .string()
  .date('Must be a valid date (YYYY-MM-DD)')
  .nullable()
  .optional();

const privacyToggleSchema = z.boolean().optional();

export const updateUserProfileSchema = z.object({
  firstName: requiredNameSchema,
  lastName: requiredNameSchema,
  apelido: nullableTextSchema(MAX_NAME_LENGTH),
  capoeiraStartedAt: capoeiraStartedAtSchema,
  showFullName: privacyToggleSchema,
  showApelido: privacyToggleSchema,
  showCapoeiraStartedAt: privacyToggleSchema,
  showSections: privacyToggleSchema,
  showFormalGroup: privacyToggleSchema,
  showFormalRank: privacyToggleSchema,
  showCareerTimeline: privacyToggleSchema,
  showEventParticipation: privacyToggleSchema,
});

export class UpdateUserProfileDto extends createZodDto(
  updateUserProfileSchema,
) {}

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
