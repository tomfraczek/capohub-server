import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';

// startedOn optional (the real-world start date is often unknown) and
// "not in the future" is validated in the service, not here - same
// reasoning as SetFormalGroupDto. Only ever a catalog Rank (see
// formal-rank-assignment.entity.ts) - setting a custom cordão active is a
// separate action, POST /users/me/custom-ranks/:id/activate (see
// custom-user-ranks.controller.ts), never this endpoint.
//
// eventId is optional evidence linking this rank to the Event where it was
// received - eligibility (attended, past/ongoing, viewer had access) is
// validated in FormalRankService.setCurrent, not here, since it requires
// DB lookups.
export const setFormalRankSchema = z.object({
  rankId: uuidSchema,
  startedOn: z.string().date('Must be a valid date (YYYY-MM-DD)').optional(),
  awardedByName: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .nullish()
    .transform((value) => (value ? value : null)),
  eventId: uuidSchema.nullish().transform((value) => (value ? value : null)),
});

export class SetFormalRankDto extends createZodDto(setFormalRankSchema) {}

export type SetFormalRankInput = z.infer<typeof setFormalRankSchema>;
