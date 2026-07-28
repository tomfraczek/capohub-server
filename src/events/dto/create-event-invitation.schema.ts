import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

// Exactly one of userId/email must be given - mirrors
// create-invitation.schema.ts (MembershipRequest's own invitation schema).
export const createEventInvitationSchema = z
  .object({
    userId: uuidSchema.optional(),
    email: z.string().trim().toLowerCase().email().max(255).optional(),
  })
  .refine(
    (value) => Boolean(value.userId) !== Boolean(value.email),
    'Exactly one of userId or email must be provided',
  );

export class CreateEventInvitationDto extends createZodDto(
  createEventInvitationSchema,
) {}

export type CreateEventInvitationInput = z.infer<
  typeof createEventInvitationSchema
>;
