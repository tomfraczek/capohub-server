import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';

// GET /groups/:groupId/role-assignments/admin-candidates - page/limit plus
// an optional free-text filter (name, apelido or user code). An empty or
// missing `search` lists every candidate - the pool is bounded by the
// Group's own formal members, unlike the global GET /users/search.
export const groupAdminCandidatesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});

export class GroupAdminCandidatesQueryDto extends createZodDto(
  groupAdminCandidatesQuerySchema,
) {}

export type GroupAdminCandidatesQuery = z.infer<
  typeof groupAdminCandidatesQuerySchema
>;
