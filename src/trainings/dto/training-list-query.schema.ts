import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import { TrainingStatus } from '../enums/training-status.enum';
import { isoDateTimeSchema } from './training-validation.helpers';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// Same limit/offset + {items,total,hasMore} convention as
// event-list-query.schema.ts (the closest sibling domain) - see
// events/events.service.ts's EventListResult.
export const trainingListQuerySchema = z.object({
  status: enumValuesSchema(Object.values(TrainingStatus)).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class TrainingListQueryDto extends createZodDto(
  trainingListQuerySchema,
) {}
export type TrainingListQueryInput = z.infer<typeof trainingListQuerySchema>;
