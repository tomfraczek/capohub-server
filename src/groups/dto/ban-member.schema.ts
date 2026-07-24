import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// `reason` is optional and free-text - shown to admins reviewing the Audit
// Log (see AuditLogEntry.description), never shown to the banned user
// through any current endpoint.
export const banMemberSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export class BanMemberDto extends createZodDto(banMemberSchema) {}

export type BanMemberInput = z.infer<typeof banMemberSchema>;
