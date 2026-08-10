import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// Every field is optional, unlike UpdateGroupDto's full-replace convention -
// notification settings are a set of independent toggles (a UI flips one
// switch at a time), so a partial PATCH is the natural shape here. Omitted
// fields keep their current (or default) value; this is never a full
// replace.
export const updateCommunityNotificationSettingsSchema = z
  .object({
    newJoinRequests: z.boolean().optional(),
    joinRequestApproved: z.boolean().optional(),
    newInvitations: z.boolean().optional(),
    invitationAccepted: z.boolean().optional(),
    invitationRejected: z.boolean().optional(),
    roleChanges: z.boolean().optional(),
    transferOwnership: z.boolean().optional(),
    archived: z.boolean().optional(),
    restored: z.boolean().optional(),
    communityDeleted: z.boolean().optional(),
    muted: z.boolean().optional(),
  })
  .strict();

export class UpdateCommunityNotificationSettingsDto extends createZodDto(
  updateCommunityNotificationSettingsSchema,
) {}

export type UpdateCommunityNotificationSettingsInput = z.infer<
  typeof updateCommunityNotificationSettingsSchema
>;
