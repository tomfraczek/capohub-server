import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// Every field optional (partial PATCH, same convention as
// update-community-notification-settings.schema.ts) - omitted fields keep
// their current (or default) value.
export const updateUserNotificationPreferencesSchema = z
  .object({
    pushEnabled: z.boolean().optional(),
    pushCommunity: z.boolean().optional(),
    pushTraining: z.boolean().optional(),
    pushEvent: z.boolean().optional(),
    pushMembership: z.boolean().optional(),
    pushGraduation: z.boolean().optional(),
    pushPayment: z.boolean().optional(),
    trainingReminder24h: z.boolean().optional(),
    trainingReminder2h: z.boolean().optional(),
    eventReminder24h: z.boolean().optional(),
    eventReminder2h: z.boolean().optional(),
  })
  .strict();

export class UpdateUserNotificationPreferencesDto extends createZodDto(
  updateUserNotificationPreferencesSchema,
) {}

export type UpdateUserNotificationPreferencesInput = z.infer<
  typeof updateUserNotificationPreferencesSchema
>;
