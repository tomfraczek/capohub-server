import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import { EventRsvpStatus } from '../enums/event-rsvp-status.enum';

// Changes an existing EventAttendee row's decision - spec: "Użytkownik może
// dowolnie zmieniać decyzję... Dowolną liczbę razy." Every value, including
// NOT_GOING, is allowed here (unlike registerForEventSchema.selfRsvpStatus)
// since this always targets an existing row.
export const updateRsvpSchema = z.object({
  rsvpStatus: enumValuesSchema(Object.values(EventRsvpStatus)),
});

export class UpdateRsvpDto extends createZodDto(updateRsvpSchema) {}

export type UpdateRsvpInput = z.infer<typeof updateRsvpSchema>;
