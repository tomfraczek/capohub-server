import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { isValidIsoCountryCode } from '../../common/validation/iso-3166-alpha2';

// Sets/replaces the caller's own discovery location (see
// user-discovery-location.entity.ts) - always a full replace, mirroring
// update-section.schema.ts's own convention: there is no partial-PATCH
// variant, since a location only ever makes sense as one complete,
// internally-consistent place.
export const setUserDiscoveryLocationSchema = z.object({
  city: z.string().trim().min(1).max(100),
  region: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .nullish()
    .transform((value) => (value ? value : null)),
  // Same ISO 3166-1 alpha-2 convention as Section.country/User.country - see
  // group-validation.helpers.ts#countryCodeSchema.
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      isValidIsoCountryCode,
      'Must be a valid ISO 3166-1 alpha-2 country code',
    ),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .nullish()
    .transform((value) => (value ? value : null)),
  source: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .nullish()
    .transform((value) => (value ? value : null)),
});

export class SetUserDiscoveryLocationDto extends createZodDto(
  setUserDiscoveryLocationSchema,
) {}

export type SetUserDiscoveryLocationInput = z.infer<
  typeof setUserDiscoveryLocationSchema
>;
