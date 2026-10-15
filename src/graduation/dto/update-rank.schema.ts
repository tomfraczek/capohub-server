import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createRankSchema } from './create-rank.schema';

// Full-replace on update, same convention as update-academy.schema.ts -
// covers name/nameFemale/description/track/previousRankId (gradation position) and
// cordSegments (replaced atomically) in one request.
export const updateRankSchema = createRankSchema;

export class UpdateRankDto extends createZodDto(updateRankSchema) {}

export type UpdateRankInput = z.infer<typeof updateRankSchema>;
