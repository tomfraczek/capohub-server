import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
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

export const updateUserSchema = z.object({
  displayName: displayNameSchema,
  theme: themeSchema,
  notificationsEnabled: notificationsEnabledSchema,
});

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
