import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// PATCH /users/me/locations/:locationId - deliberately only `name` is
// editable (a SavedLocation has no search radius at all - see its own
// comment). No city/region/countryCode/latitude/longitude
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
});

export class UpdateSavedLocationDto extends createZodDto(
  updateSavedLocationSchema,
) {}

export type UpdateSavedLocationInput = z.infer<
  typeof updateSavedLocationSchema
>;
