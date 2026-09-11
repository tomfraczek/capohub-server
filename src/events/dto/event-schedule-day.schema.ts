import { z } from 'zod';
import { isoDateTimeSchema } from './event-validation.helpers';

const MAX_SCHEDULE_DAYS = 60;

// One day's own window - see EventScheduleDay's own comment. Cross-field
// checks against the *whole list* (ascending order, no overlap) and against
// the parent Event's own startsAt/endsAt live in
// refineEventScheduleDays below, not here - a single day's own shape is all
// this schema can validate on its own.
export const eventScheduleDaySchema = z
  .object({
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
  })
  .refine(
    (day) => new Date(day.endsAt).getTime() >= new Date(day.startsAt).getTime(),
    {
      message: 'endsAt must not be before startsAt',
      path: ['endsAt'],
    },
  );

export const eventScheduleDaysSchema = z
  .array(eventScheduleDaySchema)
  .max(
    MAX_SCHEDULE_DAYS,
    `Must have at most ${MAX_SCHEDULE_DAYS} schedule days`,
  )
  .default([]);

export type EventScheduleDayInput = z.infer<typeof eventScheduleDaySchema>;

// Shared by create and update (both go through eventBaseSchema) - `days` is
// deliberately optional/empty for the common single-day Event, so this is a
// no-op for it. When present:
//  - each day must fall entirely within the Event's own startsAt/endsAt
//    frame (the one thing RSVP/capacity/notifications actually rely on -
//    a schedule day can never claim to run outside it).
//  - days must be listed in ascending, non-overlapping order (the UI
//    always generates them this way - see event-form-fields.tsx's own
//    scheduleDays sync effect - but the backend is the actual source of
//    truth, never just the client).
export function refineEventScheduleDays(
  value: {
    startsAt: string;
    endsAt: string;
    scheduleDays: EventScheduleDayInput[];
  },
  ctx: z.RefinementCtx,
): void {
  const { scheduleDays } = value;
  if (scheduleDays.length === 0) {
    return;
  }

  const eventStart = new Date(value.startsAt).getTime();
  const eventEnd = new Date(value.endsAt).getTime();

  let previousEnd: number | null = null;
  scheduleDays.forEach((day, index) => {
    const dayStart = new Date(day.startsAt).getTime();
    const dayEnd = new Date(day.endsAt).getTime();

    if (dayStart < eventStart || dayEnd > eventEnd) {
      ctx.addIssue({
        code: 'custom',
        message:
          "Each schedule day must fall within the event's own startsAt/endsAt",
        path: ['scheduleDays', index],
      });
    }
    if (previousEnd !== null && dayStart < previousEnd) {
      ctx.addIssue({
        code: 'custom',
        message: 'Schedule days must be in ascending, non-overlapping order',
        path: ['scheduleDays', index],
      });
    }
    previousEnd = dayEnd;
  });
}
