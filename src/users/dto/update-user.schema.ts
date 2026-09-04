import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  currencyCodeSchema,
  timezoneSchema,
} from '../../groups/dto/group-validation.helpers';
import { THEMES } from '../entities/user.entity';

const MIN_DISPLAY_NAME_LENGTH = 2;
const MAX_DISPLAY_NAME_LENGTH = 100;

const displayNameSchema = z
  .string()
  .trim()
  .min(
    MIN_DISPLAY_NAME_LENGTH,
    `Must be at least ${MIN_DISPLAY_NAME_LENGTH} characters`,
  )
  .max(
    MAX_DISPLAY_NAME_LENGTH,
    `Must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
  )
  .optional();

const themeSchema = z.enum(THEMES).optional();

const notificationsEnabledSchema = z.boolean().optional();

// Regional settings (module: "ustawienia regionalne z poziomu ustawień
// profilu") - reuses the exact same IANA-timezone / 3-letter-ISO-4217-shape
// validators Section still uses for its own timezone/currencyCode (see
// groups/dto/group-validation.helpers.ts), just made `.optional()` here to
// match every other field on this partial-update schema.
export const updateUserSchema = z.object({
  displayName: displayNameSchema,
  theme: themeSchema,
  notificationsEnabled: notificationsEnabledSchema,
  timezone: timezoneSchema.optional(),
  currencyCode: currencyCodeSchema.optional(),
});

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
