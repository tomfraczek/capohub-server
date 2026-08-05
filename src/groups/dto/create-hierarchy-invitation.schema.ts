import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

export const createHierarchyInvitationSchema = z
  .object({
    targetType: z.enum(['GROUP', 'SECTION']),
    targetId: uuidSchema,
  })
  .strict();

export class CreateHierarchyInvitationDto extends createZodDto(
  createHierarchyInvitationSchema,
) {}

export type CreateHierarchyInvitationInput = z.infer<
  typeof createHierarchyInvitationSchema
>;
