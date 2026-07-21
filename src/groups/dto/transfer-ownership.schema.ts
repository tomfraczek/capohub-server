import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

// newOwnerUserId must already be an active member of the group (spec: no
// invitation flow exists yet, so ownership can only move to someone
// already added - see GroupMembershipsService.transferOwnership). There is
// no `previousOwnerRole` field: the previous owner loses only the OWNER
// Role Assignment - every other Role they hold (MEMBER, ADMIN, ...) is
// left exactly as it was, since a Membership may hold several Roles for
// the same Group at once and OWNER is simply one of them being revoked.
export const transferOwnershipSchema = z
  .object({
    newOwnerUserId: uuidSchema,
  })
  .strict();

export class TransferOwnershipDto extends createZodDto(
  transferOwnershipSchema,
) {}

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
