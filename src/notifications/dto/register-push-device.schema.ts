import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import { PushPlatform } from '../enums/push-platform.enum';

export const registerPushDeviceSchema = z.object({
  token: z.string().trim().min(1).max(400),
  platform: enumValuesSchema(Object.values(PushPlatform)),
});

export class RegisterPushDeviceDto extends createZodDto(
  registerPushDeviceSchema,
) {}

export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceSchema>;
