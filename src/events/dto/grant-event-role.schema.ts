import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { EventRole } from '../enums/event-role.enum';

// OWNER is deliberately excluded - it can only move via
// POST /events/:id/transfer-ownership (mirrors
// assignable-group-role.schema.ts).
export const grantEventRoleSchema = z.object({
  userId: uuidSchema,
  role: z.enum([EventRole.ORGANIZER, EventRole.MODERATOR]),
});

export class GrantEventRoleDto extends createZodDto(grantEventRoleSchema) {}

export type GrantEventRoleInput = z.infer<typeof grantEventRoleSchema>;
