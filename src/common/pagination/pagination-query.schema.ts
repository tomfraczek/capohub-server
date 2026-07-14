import { z } from 'zod';
import { integerQueryParam } from '../validation/query.schemas';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const paginationQuerySchema = z.object({
  page: integerQueryParam(z.number().int().positive()).default(DEFAULT_PAGE),
  limit: integerQueryParam(z.number().int().positive().max(MAX_LIMIT)).default(
    DEFAULT_LIMIT,
  ),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
