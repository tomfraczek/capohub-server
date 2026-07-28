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

// A Section is a non-root Group nested under an existing Group or Section
// (see the Group/Section rename ADR) - the parent is always the route's
// :groupId/:sectionId, never a body field (mirrors how Academy/Cohort are
// created under their owning Group). Field set mirrors create-group.schema.ts,
// except `country` is required here (a Section operates in one place),
// where it is optional on a Group (which may span multiple countries).
export const createSectionSchema = z.object({
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
  isPublic: z.boolean().default(true),
  isHidden: z.boolean().default(false),
  memberInvitesAllowed: z.boolean().default(false),
  timezone: timezoneSchema,
  currencyCode: currencyCodeSchema,
  country: countryCodeSchema,
  city: citySchema,
});

export class CreateSectionDto extends createZodDto(createSectionSchema) {}

export type CreateSectionInput = z.infer<typeof createSectionSchema>;
