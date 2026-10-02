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

const MIN_BIRTH_DATE = '1900-01-01';

// Not in the future and not before MIN_BIRTH_DATE - compared as
// 'YYYY-MM-DD' strings, which order the same as the dates they encode.
const birthDateSchema = z
  .string()
  .date('Must be a valid date (YYYY-MM-DD)')
  .refine((value) => value >= MIN_BIRTH_DATE, {
    message: `Must not be before ${MIN_BIRTH_DATE}`,
  })
  .refine((value) => value <= new Date().toISOString().slice(0, 10), {
    message: 'Must not be in the future',
  })
  .nullable()
  .optional();

// Loose international format: optional leading "+", then digits with
// optional spaces/dashes/parentheses, 6-15 digits in total (E.164 max).
const PHONE_NUMBER_MAX_LENGTH = 32;
const PHONE_NUMBER_PATTERN = /^\+?[0-9 ()-]+$/;

const phoneNumberSchema = z
  .string()
  .trim()
  .min(1, 'Must not be empty')
  .max(
    PHONE_NUMBER_MAX_LENGTH,
    `Must be at most ${PHONE_NUMBER_MAX_LENGTH} characters`,
  )
  .regex(PHONE_NUMBER_PATTERN, 'Must be a valid phone number')
  .refine(
    (value) => {
      const digits = value.replace(/\D/g, '').length;
      return digits >= 6 && digits <= 15;
    },
    { message: 'Must contain between 6 and 15 digits' },
  )
  .nullable()
  .optional();

const privacyToggleSchema = z.boolean().optional();

export const updateUserProfileSchema = z.object({
  firstName: requiredNameSchema,
  lastName: requiredNameSchema,
  apelido: nullableTextSchema(MAX_NAME_LENGTH),
  capoeiraStartedAt: capoeiraStartedAtSchema,
  birthDate: birthDateSchema,
  phoneNumber: phoneNumberSchema,
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
