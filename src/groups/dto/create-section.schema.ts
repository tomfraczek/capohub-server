import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import {
  citySchema,
  countryCodeSchema,
  geonameIdSchema,
  latitudeSchema,
  longitudeSchema,
  optionalNullableSocialUrl,
  optionalNullableUrl,
  refineCityIdentification,
  refineCoordinatePair,
  regionSchema,
} from './group-validation.helpers';

const DESCRIPTION_MAX_LENGTH = 5000;
const URL_MAX_LENGTH = 2048;

// Exported separately from createSectionSchema (below) purely so
// update-section.schema.ts can call `.strict()` on it - see
// create-group.schema.ts's identical comment on createGroupObjectSchema.
//
// A Section is a non-root Group nested under an existing Group or Section
// (see the Group/Section rename ADR) - the parent is always the route's
// :groupId/:sectionId, never a body field (mirrors how Academy/Cohort are
// created under their owning Group). Field set mirrors
// create-group.schema.ts - country/city are required on both (a Section
// always operates in one place, and a Group is no longer allowed to leave
// them blank either).
//
// Deliberately no `timezone`/`currencyCode` input fields (module: "w
// edycji/tworzeniu sekcji nie powinno być ani waluty ani strefy czasowej" -
// same regional-settings-are-not-a-per-community-field rule Group already
// followed, see MoveRegionalSettingsFromGroupToUser). Both are still real
// columns on Section (needed for scheduling Trainings/Events in the
// Section's own local time and displaying its own prices), just never
// client-supplied: SectionsService.applyFields always derives `timezone`
// from the chosen city's own GeoNames timezone (the same dataset
// `geonameId` already resolves against for country/city/region/lat/lng -
// see that method's own comment), and `currencyCode` is seeded once, at
// create time only, from the creating User's own regional settings (see
// update-user.schema.ts) - never touched again on update.
export const createSectionObjectSchema = z.object({
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
  // Lenient - see create-group.schema.ts's identical comment on
  // optionalNullableSocialUrl; logoUrl/coverImageUrl above stay strict
  // (picker/upload-only, never hand-typed).
  websiteUrl: optionalNullableSocialUrl(URL_MAX_LENGTH),
  facebookUrl: optionalNullableSocialUrl(URL_MAX_LENGTH),
  instagramUrl: optionalNullableSocialUrl(URL_MAX_LENGTH),
  youtubeUrl: optionalNullableSocialUrl(URL_MAX_LENGTH),
  isPublic: z.boolean().default(true),
  isHidden: z.boolean().default(false),
  memberInvitesAllowed: z.boolean().default(false),
  country: countryCodeSchema,
  city: citySchema,
  region: regionSchema,
  // The GeoNames identifier of the chosen city - see
  // create-group.schema.ts's identical field for the full reasoning.
  geonameId: geonameIdSchema,
  // Precise venue coordinates for nearby discovery - optional (a Section
  // simply never appears in nearby discovery until placed), but never
  // partially set - see group-validation.helpers.ts's own comment.
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export const createSectionSchema = createSectionObjectSchema
  .superRefine(refineCityIdentification)
  .superRefine(refineCoordinatePair);

export class CreateSectionDto extends createZodDto(createSectionSchema) {}

export type CreateSectionInput = z.infer<typeof createSectionSchema>;
