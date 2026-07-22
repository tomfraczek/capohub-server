import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';

// Either userId (for an existing account) or email (for a not-yet-registered
// person) must be provided, but not both. Validated at the service level
// because Zod's discriminated union on an undefined field is awkward.
export const createInvitationSchema = z.object({
  targetType: z.nativeEnum(MembershipRequestTarget),
  // Invite an existing user by their internal UUID
  invitedUserId: uuidSchema.nullish().transform((v) => v ?? null),
  // Invite by email (normalized by the service; sent to the email or linked
  // on registration)
  invitedEmail: z
    .string()
    .trim()
    .email('Must be a valid email address')
    .max(255)
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null)),
});

export class CreateInvitationDto extends createZodDto(createInvitationSchema) {}
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
