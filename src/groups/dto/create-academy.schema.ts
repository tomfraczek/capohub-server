import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';

const ADDRESS_MAX_LENGTH = 2000;
const OPENING_HOURS_MAX_LENGTH = 1000;
const DESCRIPTION_MAX_LENGTH = 5000;
const URL_MAX_LENGTH = 2048;
const MAX_PHOTOS = 20;

const nullableCoordinate = (min: number, max: number) =>
  z
    .number()
    .min(min, `Must be at least ${min}`)
    .max(max, `Must be at most ${max}`)
    .nullish()
    .transform((value) => (value === undefined ? null : value));

const photoUrlSchema = z
  .string()
  .trim()
  .url('Must be a valid URL')
  .max(URL_MAX_LENGTH, `Must be at most ${URL_MAX_LENGTH} characters`);

export const createAcademySchema = z.object({
  name: z.string().trim().min(1).max(150),
  address: optionalNullableText(ADDRESS_MAX_LENGTH),
  latitude: nullableCoordinate(-90, 90),
  longitude: nullableCoordinate(-180, 180),
  contactEmail: z
    .string()
    .trim()
    .email('Must be a valid email address')
    .max(255)
    .nullish()
    .transform((value) => (value ? value : null)),
  contactPhone: optionalNullableText(50),
  openingHours: optionalNullableText(OPENING_HOURS_MAX_LENGTH),
  photoUrls: z
    .array(photoUrlSchema)
    .max(MAX_PHOTOS, `Must have at most ${MAX_PHOTOS} photos`)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null)),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
});

export class CreateAcademyDto extends createZodDto(createAcademySchema) {}

export type CreateAcademyInput = z.infer<typeof createAcademySchema>;
