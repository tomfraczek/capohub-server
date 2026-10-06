import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { booleanQuerySchema } from '../../common/validation/query.schemas';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import { EventStatus } from '../enums/event-status.enum';
import { EventType } from '../enums/event-type.enum';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Every filter is optional - an unfiltered call returns every Event the
// caller is allowed to see under this community, subject to the
// visibility/membership/invitation rules resolved in EventsService (never
// a fixed permission check - see events-api.md "Visibility").
export const eventListQuerySchema = z.object({
  status: enumValuesSchema(Object.values(EventStatus)).optional(),
  type: enumValuesSchema(Object.values(EventType)).optional(),
  // Only Events whose endsAt is >= this instant.
  from: z.string().datetime({ offset: true }).optional(),
  // Only Events whose startsAt is <= this instant.
  to: z.string().datetime({ offset: true }).optional(),
  // GET /events (the caller's own feed) only: just Events the caller
  // actually took part in - an EventAttendee row for themselves with a
  // participating RSVP (PARTICIPATING_RSVP_STATUSES), the same rule
  // FormalRankService applies to a rank's evidence Event. Ignored by the
  // community-scoped list.
  attended: booleanQuerySchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class EventListQueryDto extends createZodDto(eventListQuerySchema) {}

export type EventListQueryInput = z.infer<typeof eventListQuerySchema>;
