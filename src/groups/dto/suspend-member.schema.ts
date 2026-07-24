import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// `until` is optional - omitting it means an indefinite suspension that
// only ends via an explicit Unsuspend (see MembershipSuspension). When
// given, it must be a future timestamp - a suspension ending in the past
// would be a no-op that the caller almost certainly did not intend.
export const suspendMemberSchema = z
  .object({
    until: z
      .string()
      .datetime()
      .refine(
        (value) => new Date(value).getTime() > Date.now(),
        'until must be in the future',
      )
      .optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export class SuspendMemberDto extends createZodDto(suspendMemberSchema) {}

export type SuspendMemberInput = z.infer<typeof suspendMemberSchema>;
