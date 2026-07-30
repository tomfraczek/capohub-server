import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Same items/total/hasMore + limit/offset shape as
// events/dto/event-list-query.schema.ts (the closest, most recent
// precedent for a capped/simple list without true page navigation - see
// docs/api-conventions.md "Dashboard section shape"), not the older
// page/limit + data/meta PaginatedResponse convention.
//
// Deliberately no "archive" toggle here - the active list and the
// OWNER/ADMIN-only archive are two separate endpoints with two separate
// GroupPermission gates (ANNOUNCEMENT_VIEW vs ANNOUNCEMENT_ARCHIVE_VIEW),
// never one endpoint whose query params could let a plain member request
// archived/expired Announcements the guard never checked for (task
// requirement: "Nie pozwalaj zwykłemu użytkownikowi wykorzystać parametrów
// listy do obejścia widoczności").
export const announcementListQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class AnnouncementListQueryDto extends createZodDto(
  announcementListQuerySchema,
) {}

export type AnnouncementListQueryInput = z.infer<
  typeof announcementListQuerySchema
>;
