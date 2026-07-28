import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';

export const transferEventOwnershipSchema = z.object({
  toUserId: uuidSchema,
});

export class TransferEventOwnershipDto extends createZodDto(
  transferEventOwnershipSchema,
) {}

export type TransferEventOwnershipInput = z.infer<
  typeof transferEventOwnershipSchema
>;
