import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { isoDateTimeSchema } from '../../events/dto/event-validation.helpers';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 5000;

// `recipientGroupId` is the only recipient input this schema takes -
// omitted/null means "every current member of the community this
// Announcement is posted under" (the route's :groupId/:sectionId, resolved
// server-side to AnnouncementRecipientType.GROUP or .SECTION - see
// AnnouncementsService.create); a UUID means "the members of that specific,
// active Recipient Group" (-> .RECIPIENT_GROUP). There is deliberately no
// separate `recipientType: GROUP | SECTION` input field here - the route
// already fixes exactly one of those two, so asking the caller to also
// state it in the body would only invite a contradictory request (e.g.
// POST /groups/:groupId/announcements with recipientType: SECTION) for no
// benefit; the stored/returned `recipientType` (see announcement-response.dto.ts)
// is still exactly the three-way value the API contract calls for, just
// computed rather than duplicated as caller input.
export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(BODY_MAX_LENGTH),
  recipientGroupId: uuidSchema.nullish().transform((value) => value ?? null),
  isPinned: z.boolean().default(false),
  // Only OWNER/ADMIN can even reach this endpoint (ANNOUNCEMENT_MANAGE -
  // see announcements.controller.ts), so no extra gating is needed here.
  isImportant: z.boolean().default(false),
  expiresAt: isoDateTimeSchema.refine(
    (value) => new Date(value).getTime() > Date.now(),
    'expiresAt must be in the future',
  ),
});

export class CreateAnnouncementDto extends createZodDto(
  createAnnouncementSchema,
) {}

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
