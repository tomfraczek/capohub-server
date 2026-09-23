import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { CareerTimelineEntryType } from '../enums/career-timeline-entry-type.enum';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Comma-separated, e.g. ?types=RECEIVED_RANK,BATIZADO - same convention as
// tagIdsQuerySchema (see song-list-query.schema.ts). A missing param means
// "every type" (subject to the usual visibility rules) - it does NOT mean
// "no types".
const typesQuerySchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((type) => type.trim())
      .filter((type) => type.length > 0),
  )
  .pipe(z.array(z.nativeEnum(CareerTimelineEntryType)))
  .transform((types) => Array.from(new Set(types)))
  .optional();

export const careerTimelineQuerySchema = z.object({
  types: typesQuerySchema,
  dateFrom: z.string().date('Must be a valid date (YYYY-MM-DD)').optional(),
  dateTo: z.string().date('Must be a valid date (YYYY-MM-DD)').optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class CareerTimelineQueryDto extends createZodDto(
  careerTimelineQuerySchema,
) {}

export type CareerTimelineQueryInput = z.infer<
  typeof careerTimelineQuerySchema
>;
