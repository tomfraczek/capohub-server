import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import {
  currencyCodeSchema,
  optionalNullableUrl,
  timezoneSchema,
} from './group-validation.helpers';

const DESCRIPTION_MAX_LENGTH = 5000;
const URL_MAX_LENGTH = 2048;

// Exported separately from createGroupSchema (below) purely so
// update-group.schema.ts can call `.strict()` on it - `.strict()` is a
// ZodObject-only method, unavailable once `.superRefine()` wraps it in a
// ZodEffects.
//
// No parentGroupId here: a Group's position in the hierarchy is set via
// GroupHierarchyService.attachChildGroup, never as a create-time body
// field (see the organizational-domain rebuild, stage 1). No
// country/city/region/geonameId either - a Group is an organizational
// container that may span many places (or none); those fields live on
// Section only (see create-section.schema.ts).
export const createGroupObjectSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
  logoUrl: optionalNullableUrl(URL_MAX_LENGTH),
  coverImageUrl: optionalNullableUrl(URL_MAX_LENGTH),
  contactEmail: z
    .string()
    .trim()
    .email('Must be a valid email address')
    .max(255)
    .nullish()
    .transform((value) => (value ? value : null)),
  contactPhone: optionalNullableText(50),
  websiteUrl: optionalNullableUrl(URL_MAX_LENGTH),
  facebookUrl: optionalNullableUrl(URL_MAX_LENGTH),
  instagramUrl: optionalNullableUrl(URL_MAX_LENGTH),
  youtubeUrl: optionalNullableUrl(URL_MAX_LENGTH),
  // Whether users can join without admin approval (true = auto-join,
  // false = creates a JOIN_REQUEST).
  isPublic: z.boolean().default(true),
  // Whether this Group appears in the regular discovery search
  // and listings.  Hidden resources are still accessible via direct link,
  // publicCode, or QR code.
  isHidden: z.boolean().default(false),
  // Whether ordinary MEMBERs may send Invitations on behalf of this Group.
  // Defaults to false (only ADMIN/OWNER may invite).
  memberInvitesAllowed: z.boolean().default(false),
  timezone: timezoneSchema,
  currencyCode: currencyCodeSchema,
});

export const createGroupSchema = createGroupObjectSchema;

export class CreateGroupDto extends createZodDto(createGroupSchema) {}

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
