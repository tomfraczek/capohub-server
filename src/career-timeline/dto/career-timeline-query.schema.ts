import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { CareerTimelineCategory } from '../enums/career-timeline-category.enum';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Comma-separated, e.g. ?categories=FORMAL_RANK,EVENT - same convention as
// tagIdsQuerySchema (see song-list-query.schema.ts). A missing param means
// "every category" (subject to the usual visibility rules) - it does NOT
// mean "no categories".
const categoriesQuerySchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((category) => category.trim())
      .filter((category) => category.length > 0),
  )
  .pipe(z.array(z.nativeEnum(CareerTimelineCategory)))
  .transform((categories) => Array.from(new Set(categories)))
  .optional();

export const careerTimelineQuerySchema = z.object({
  categories: categoriesQuerySchema,
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
