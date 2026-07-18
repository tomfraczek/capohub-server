import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { LearningStatus } from '../enums/learning-status.enum';

const LEARNING_STATUS_VALUES = Object.values(LearningStatus) as [
  LearningStatus,
  ...LearningStatus[],
];

export const setLearningStatusSchema = z.object({
  status: z.enum(LEARNING_STATUS_VALUES),
});

export class SetLearningStatusDto extends createZodDto(
  setLearningStatusSchema,
) {}

export type SetLearningStatusInput = z.infer<typeof setLearningStatusSchema>;
