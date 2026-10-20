import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Same limit/offset + items/total/hasMore convention as
// recipient-group-eligible-members-query.schema.ts. `search` is required
// here (unlike that endpoint's optional filter) - GET /users/search must
// never degrade into "list every user" (module spec). The stricter
// minimum-length rule (2 chars, with a user-code exception) is enforced in
// UserProfileService.searchUsers, not here, since it depends on
// parseUserCodePrefix.
export const userSearchQuerySchema = z.object({
  search: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class UserSearchQueryDto extends createZodDto(userSearchQuerySchema) {}

export type UserSearchQueryInput = z.infer<typeof userSearchQuerySchema>;
