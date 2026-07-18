import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalTrimmedStringQuerySchema } from '../../common/validation/query.schemas';

// No pagination - the instrument catalogue is small and curated by CMS
// (spec section 7/15).
export const instrumentListQuerySchema = z.object({
  search: optionalTrimmedStringQuerySchema,
});

export class InstrumentListQueryDto extends createZodDto(
  instrumentListQuerySchema,
) {}

export type InstrumentListQuery = z.infer<typeof instrumentListQuerySchema>;
