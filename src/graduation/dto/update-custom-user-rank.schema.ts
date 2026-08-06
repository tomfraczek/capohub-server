import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createCustomUserRankSchema } from './create-custom-user-rank.schema';

// Full-replace on update, same convention as update-rank.schema.ts.
export const updateCustomUserRankSchema = createCustomUserRankSchema;

export class UpdateCustomUserRankDto extends createZodDto(
  updateCustomUserRankSchema,
) {}

export type UpdateCustomUserRankInput = z.infer<
  typeof updateCustomUserRankSchema
>;
