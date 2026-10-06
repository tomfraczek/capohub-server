import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';

// POST .../formal-rank-requests/:id/approve - body optional. `rankId`
// confirms a different rank of the same Group's catalog than the one the
// user asked for (they picked the wrong one); omitted = confirm as asked.
export const approveFormalRankRequestSchema = z
  .object({
    rankId: uuidSchema.nullish().transform((value) => value ?? null),
  })
  .default({ rankId: null });

export class ApproveFormalRankRequestDto extends createZodDto(
  approveFormalRankRequestSchema,
) {}

export type ApproveFormalRankRequestInput = z.infer<
  typeof approveFormalRankRequestSchema
>;

// POST .../formal-rank-requests/:id/reject - body optional; `reason` is
// shown to the user in the rejection notification.
export const rejectFormalRankRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .default({ reason: null });

export class RejectFormalRankRequestDto extends createZodDto(
  rejectFormalRankRequestSchema,
) {}

export type RejectFormalRankRequestInput = z.infer<
  typeof rejectFormalRankRequestSchema
>;
