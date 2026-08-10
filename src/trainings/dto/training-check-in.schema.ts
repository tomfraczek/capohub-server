import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// Same single-field shape as Event's eventCheckInSchema (see
// events/dto/event-attendance-mutation.schema.ts) - both check-in
// endpoints share one request contract by design (module spec §11).
export const trainingCheckInSchema = z.object({
  identity: z.string().trim().min(1),
});

export class TrainingCheckInDto extends createZodDto(trainingCheckInSchema) {}
export type TrainingCheckInInput = z.infer<typeof trainingCheckInSchema>;
