import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { isValidIsoCountryCode } from '../../common/validation/iso-3166-alpha2';
import {
  DEFAULT_SAVED_LOCATION_RADIUS_KM,
  MAX_SAVED_LOCATION_RADIUS_KM,
} from '../saved-location.constants';

const nullableTextSchema = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(maxLength, `Must be at most ${maxLength} characters`)
    .nullish()
    .transform((value) => (value ? value : null));

// POST /users/me/locations - a SavedLocation is always created from a
// resolved place (the search/geocoding flow, e.g. PlaceSearchResultDto),
// never from freehand latitude/longitude typed by the caller - the client
// enforces that by construction (the "Dodaj lokalizację" flow only ever
// forwards a search result here), this schema just validates the shape
// lands in range regardless of where it came from.
export const createSavedLocationSchema = z.object({
  name: nullableTextSchema(100),
  city: nullableTextSchema(100),
  region: nullableTextSchema(100),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      isValidIsoCountryCode,
      'Must be a valid ISO 3166-1 alpha-2 country code',
    )
    .nullish()
    .transform((value) => (value ? value : null)),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z
    .number()
    .int()
    .positive()
    .max(MAX_SAVED_LOCATION_RADIUS_KM)
    .default(DEFAULT_SAVED_LOCATION_RADIUS_KM),
});

export class CreateSavedLocationDto extends createZodDto(
  createSavedLocationSchema,
) {}

export type CreateSavedLocationInput = z.infer<
  typeof createSavedLocationSchema
>;
