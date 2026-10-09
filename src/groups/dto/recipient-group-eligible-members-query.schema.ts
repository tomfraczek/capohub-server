import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Same limit/offset + items/total/hasMore convention as
// announcements/dto/announcement-list-query.schema.ts - a capped page, not
// the older page/meta PaginatedResponse shape (see docs/api-conventions.md
// "Dashboard section shape"). `search` is optional and matches against
// firstName/lastName/apelido only - never email or any other field (see
// role-assignments.service.ts's own findEligibleMembers comment for why
// email is never exposed here).
export const recipientGroupEligibleMembersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class RecipientGroupEligibleMembersQueryDto extends createZodDto(
  recipientGroupEligibleMembersQuerySchema,
) {}

export type RecipientGroupEligibleMembersQueryInput = z.infer<
  typeof recipientGroupEligibleMembersQuerySchema
>;
