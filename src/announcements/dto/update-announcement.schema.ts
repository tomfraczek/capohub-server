import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { isoDateTimeSchema } from '../../events/dto/event-validation.helpers';

const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 5000;

// Deliberately its own shape, not createAnnouncementSchema reused - the
// recipient (`recipientGroupId`) is immutable after publish (task
// requirement) and `sendPushNotification` has no meaning on an edit (task
// requirement: no re-send on a plain edit), so neither field exists here at
// all rather than being accepted-and-ignored.
export const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(BODY_MAX_LENGTH),
  isPinned: z.boolean(),
  expiresAt: isoDateTimeSchema.refine(
    (value) => new Date(value).getTime() > Date.now(),
    'expiresAt must be in the future',
  ),
});

export class UpdateAnnouncementDto extends createZodDto(
  updateAnnouncementSchema,
) {}

export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
