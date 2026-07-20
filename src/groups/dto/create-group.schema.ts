import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';
import { GroupVisibility } from '../enums/group-visibility.enum';
import {
  currencyCodeSchema,
  optionalNullableUrl,
  timezoneSchema,
} from './group-validation.helpers';

const DESCRIPTION_MAX_LENGTH = 5000;
const URL_MAX_LENGTH = 2048;

export const createGroupSchema = z.object({
  // Omitted/null -> creates a Root Group. Present -> creates a Child Group
  // under an existing Group (validated by GroupHierarchyService). There is
  // deliberately one creation endpoint, not two - "Root" vs "Child" is
  // entirely determined by this field, matching how the Group entity itself
  // represents both cases identically (see organization-domain.md#group).
  parentGroupId: uuidSchema.nullish().transform((value) => value ?? null),
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
  visibility: z.nativeEnum(GroupVisibility).default(GroupVisibility.PUBLIC),
  timezone: timezoneSchema,
  currencyCode: currencyCodeSchema,
});

export class CreateGroupDto extends createZodDto(createGroupSchema) {}

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
