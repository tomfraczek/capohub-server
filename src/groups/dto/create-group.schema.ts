import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import {
  citySchema,
  countryCodeSchema,
  currencyCodeSchema,
  optionalNullableUrl,
  timezoneSchema,
} from './group-validation.helpers';

const DESCRIPTION_MAX_LENGTH = 5000;
const URL_MAX_LENGTH = 2048;

// A Group is always a root-level entity - creating a nested/child entity
// under a Group goes through POST /groups/:groupId/sections instead (see
// create-section.schema.ts and the Group/Section rename ADR). There is no
// parentGroupId here: unlike before the rename, "root vs child" is no
// longer a single creation endpoint distinguished by an optional field -
// Group (this schema) and Section each have their own creation endpoint.
export const createGroupSchema = z.object({
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
  // Optional for a Group (unlike Section) - a Group may span multiple
  // countries, e.g. an international federation (see the Group/Section
  // rename ADR).
  country: countryCodeSchema.nullish().transform((value) => value ?? null),
  city: citySchema,
});

export class CreateGroupDto extends createZodDto(createGroupSchema) {}

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
