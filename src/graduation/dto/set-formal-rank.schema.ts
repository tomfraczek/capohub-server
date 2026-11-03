import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';

// startedOn optional on the wire - an omitted one defaults to today in
// FormalRankService.setCurrent, so a new assignment/request always has a
// date of record - and "not in the future" is validated in the service,
// not here - same reasoning as SetFormalGroupDto. Only ever a catalog Rank (see
// formal-rank-assignment.entity.ts) - setting an independent/custom
// cordão is a wholly separate resource, PUT /users/me/custom-rank (see
// custom-rank.controller.ts), never this endpoint.
//
// eventId is optional evidence linking this rank to the Event where it was
// received - eligibility (attended, past/ongoing, viewer had access) is
// validated in FormalRankService.setCurrent, not here, since it requires
// DB lookups.
//
// eventName/eventYear/eventMonth/eventDay are the free-text alternative
// for an event that isn't in CapoHub (most batizados before the app
// existed): a name plus a partial, remembered date - each part optional,
// but a month needs its year and a day its month, so the date is always
// one of "nothing", "YYYY", "YYYY-MM" or "YYYY-MM-DD". Mutually exclusive
// with eventId. "Not in the future" is checked in the service, like
// startedOn.
const optionalInt = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((value) => value ?? null);

export const setFormalRankSchema = z
  .object({
    rankId: uuidSchema,
    startedOn: z.string().date('Must be a valid date (YYYY-MM-DD)').optional(),
    awardedByName: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .nullish()
      .transform((value) => (value ? value : null)),
    eventId: uuidSchema.nullish().transform((value) => (value ? value : null)),
    eventName: z
      .string()
      .trim()
      .max(150)
      .nullish()
      .transform((value) => (value ? value : null)),
    eventYear: optionalInt(1900, 9999),
    eventMonth: optionalInt(1, 12),
    eventDay: optionalInt(1, 31),
  })
  .superRefine((value, ctx) => {
    if (value.eventId && value.eventName) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventName'],
        message: 'Provide either eventId or eventName, not both',
      });
    }
    const hasDatePart =
      value.eventYear !== null ||
      value.eventMonth !== null ||
      value.eventDay !== null;
    if (hasDatePart && !value.eventName) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventName'],
        message: 'An event date requires eventName',
      });
    }
    if (value.eventMonth !== null && value.eventYear === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventYear'],
        message: 'eventMonth requires eventYear',
      });
    }
    if (value.eventDay !== null && value.eventMonth === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventMonth'],
        message: 'eventDay requires eventMonth',
      });
    }
    if (
      value.eventYear !== null &&
      value.eventMonth !== null &&
      value.eventDay !== null
    ) {
      const daysInMonth = new Date(
        Date.UTC(value.eventYear, value.eventMonth, 0),
      ).getUTCDate();
      if (value.eventDay > daysInMonth) {
        ctx.addIssue({
          code: 'custom',
          path: ['eventDay'],
          message: 'Must be a valid day of the given month',
        });
      }
    }
  });

export class SetFormalRankDto extends createZodDto(setFormalRankSchema) {}

export type SetFormalRankInput = z.infer<typeof setFormalRankSchema>;
