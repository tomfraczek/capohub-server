import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// ~366 days (leap-year safe) - "maks. około 1 roku na request" (module
// spec §7). The frontend computes day/week/month ranges itself and sends
// them here as plain from/to - there is no day/week/month endpoint (module
// spec §7 "Nie potrzebujemy endpointu day/week/month").
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

// Same ISO-8601-with-offset shape as EventListQueryDto's from/to (the
// closest sibling convention - see events/dto/event-list-query.schema.ts),
// both required here (unlike Events/Trainings' optional from/to filters):
// a Calendar request without a bounded range would have to return
// "everything", which the module spec explicitly forbids (§13 "Nie
// zwracaj niekompletnego miesiąca bez informacji" implies a range is
// always given, never inferred).
export const calendarRangeQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine(
    (query) => new Date(query.from).getTime() < new Date(query.to).getTime(),
    {
      message: 'from must be strictly before to',
      path: ['from'],
    },
  )
  .refine(
    (query) =>
      new Date(query.to).getTime() - new Date(query.from).getTime() <=
      MAX_RANGE_MS,
    {
      message: 'from/to must not span more than ~1 year',
      path: ['to'],
    },
  );

export class CalendarRangeQueryDto extends createZodDto(
  calendarRangeQuerySchema,
) {}

export type CalendarRangeQueryInput = z.infer<typeof calendarRangeQuerySchema>;
