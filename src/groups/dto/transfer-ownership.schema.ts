import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { assignableGroupRoleSchema } from './assignable-group-role.schema';

// newOwnerUserId must already be an active member of the group (spec: no
// invitation flow exists yet, so ownership can only move to someone already
// added - see GroupMembershipsService.transferOwnership). previousOwnerRole
// is required, not defaulted: since transferring ownership always leaves the
// previous owner in some other role, the caller states which one explicitly
// rather than the service silently picking ADMIN.
export const transferOwnershipSchema = z.object({
  newOwnerUserId: uuidSchema,
  previousOwnerRole: assignableGroupRoleSchema,
});

export class TransferOwnershipDto extends createZodDto(
  transferOwnershipSchema,
) {}

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
