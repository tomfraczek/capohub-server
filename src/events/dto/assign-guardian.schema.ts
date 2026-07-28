import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

export const assignGuardianSchema = z.object({
  guardianUserId: uuidSchema,
});

export class AssignGuardianDto extends createZodDto(assignGuardianSchema) {}

export type AssignGuardianInput = z.infer<typeof assignGuardianSchema>;
