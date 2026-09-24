import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { MAX_SAVED_LOCATION_RADIUS_KM } from '../saved-location.constants';

// PATCH /users/me/locations/:locationId - deliberately only `name` and
// `radiusKm` are editable. No city/region/countryCode/latitude/longitude
// here at all (not even as optional fields) - changing the actual place is
// not an "edit", it's picking a different SavedLocation via search (module:
// "Jeżeli użytkownik chce zmienić faktyczne miejsce, powinien wybrać nowe
// miejsce przez wyszukiwarkę"). Renaming never touches the coordinates.
export const updateSavedLocationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(100, 'Must be at most 100 characters')
    .nullish()
    .transform((value) => (value ? value : null))
    .optional(),
  // No `.default()` here, unlike the create schema - an omitted key must
  // stay `undefined` (leave the existing radius untouched), never reset to
  // the default radius on every rename-only PATCH.
  radiusKm: z
    .number()
    .int()
    .positive()
    .max(MAX_SAVED_LOCATION_RADIUS_KM)
    .optional(),
});

export class UpdateSavedLocationDto extends createZodDto(
  updateSavedLocationSchema,
) {}

export type UpdateSavedLocationInput = z.infer<
  typeof updateSavedLocationSchema
>;
