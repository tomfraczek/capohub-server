import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { uuidSchema } from '../../common/validation/uuid.schema';

// startedOn is optional - the real-world start date is often not known (or
// not yet decided) at the moment of setting a formal Group, and this
// service never invents one (see UserProfileService.setFormalGroup /
// formal-group-affiliation.entity.ts). "Not in the future" is validated in
// the service, not here, since "future" depends on the current date at
// call time, not just the shape of the input.
export const setFormalGroupSchema = z.object({
  groupId: uuidSchema,
  startedOn: z.string().date('Must be a valid date (YYYY-MM-DD)').optional(),
});

export class SetFormalGroupDto extends createZodDto(setFormalGroupSchema) {}

export type SetFormalGroupInput = z.infer<typeof setFormalGroupSchema>;
