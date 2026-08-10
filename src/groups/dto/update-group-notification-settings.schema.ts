import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// Deliberately the one settable field - see
// GroupNotificationSettingsResponseDto's own comment on why the other nine
// CommunityNotificationSettings booleans are not exposed here.
export const updateGroupNotificationSettingsSchema = z
  .object({
    muted: z.boolean().optional(),
  })
  .strict();

export class UpdateGroupNotificationSettingsDto extends createZodDto(
  updateGroupNotificationSettingsSchema,
) {}

export type UpdateGroupNotificationSettingsInput = z.infer<
  typeof updateGroupNotificationSettingsSchema
>;
