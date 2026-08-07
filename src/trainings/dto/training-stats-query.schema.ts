import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { isoDateTimeSchema } from './training-validation.helpers';

export const trainingStatsQuerySchema = z
  .object({
    dateFrom: isoDateTimeSchema,
    dateTo: isoDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    if (new Date(value.dateTo).getTime() < new Date(value.dateFrom).getTime()) {
      ctx.addIssue({
        code: 'custom',
        message: 'dateTo must not be before dateFrom',
        path: ['dateTo'],
      });
    }
  });

export class TrainingStatsQueryDto extends createZodDto(
  trainingStatsQuerySchema,
) {}
export type TrainingStatsQueryInput = z.infer<typeof trainingStatsQuerySchema>;
