import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';

const VALID_TARGET_TYPES = Object.values(MembershipRequestTarget).join(', ');

// Body schema for POST /groups/:groupId/join or POST /sections/:sectionId/join.
// `targetType` is mandatory - the backend never infers the caller's intent.
// Omitting it, or supplying an unrecognised value, returns 400 Bad Request.
export const joinGroupSchema = z.object({
  targetType: z.nativeEnum(MembershipRequestTarget, {
    message: `targetType is required and must be one of: ${VALID_TARGET_TYPES}`,
  }),
});

export class JoinGroupDto extends createZodDto(joinGroupSchema) {}
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
