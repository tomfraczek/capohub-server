import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';

// GET /groups/:id/followers - plain page/limit pagination, no filters.
export const groupFollowersQuerySchema = paginationQuerySchema;

export class GroupFollowersQueryDto extends createZodDto(
  groupFollowersQuerySchema,
) {}

export type GroupFollowersQuery = z.infer<typeof groupFollowersQuerySchema>;
