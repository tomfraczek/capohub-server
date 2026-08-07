import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

export const recordTrainingAttendanceSchema = z.object({
  attended: z.boolean(),
});

export class RecordTrainingAttendanceDto extends createZodDto(
  recordTrainingAttendanceSchema,
) {}
export type RecordTrainingAttendanceInput = z.infer<
  typeof recordTrainingAttendanceSchema
>;
