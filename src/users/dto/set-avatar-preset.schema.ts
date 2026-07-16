import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const MAX_PRESET_AVATAR_ID_LENGTH = 100;
const PRESET_AVATAR_ID_PATTERN = /^[a-z0-9_-]+$/;

const presetAvatarIdSchema = z
  .string()
  .trim()
  .min(1, 'Must be at least 1 character')
  .max(
    MAX_PRESET_AVATAR_ID_LENGTH,
    `Must be at most ${MAX_PRESET_AVATAR_ID_LENGTH} characters`,
  )
  .regex(
    PRESET_AVATAR_ID_PATTERN,
    'Must contain only lowercase letters, digits, hyphens and underscores',
  );

export const setAvatarPresetSchema = z.object({
  presetAvatarId: presetAvatarIdSchema,
});

export class SetAvatarPresetDto extends createZodDto(setAvatarPresetSchema) {}
