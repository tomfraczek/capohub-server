import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { SLUG_PATTERN } from '../../common/utils/slugify';
import {
  checkNoDuplicates,
  optionalNullableText,
} from '../../songs/dto/song-validation.helpers';
import {
  instrumentMediaListSchema,
  InstrumentMediaItemInput,
} from './instrument-media-input.schema';

const MAX_ALTERNATIVE_NAMES = 30;
const SHORT_DESCRIPTION_MAX_LENGTH = 300;
// Educational content (history, construction, how to play, role in
// bateria) is expected to be long-form - no arbitrarily low limit (spec
// section 14).
const LONG_TEXT_MAX_LENGTH = 20000;

const alternativeNamesSchema = z
  .array(z.string().trim().min(1).max(150))
  .max(MAX_ALTERNATIVE_NAMES)
  .default([])
  .superRefine((items, ctx) =>
    checkNoDuplicates(
      items,
      (item) => item.toLowerCase(),
      'alternativeNames must not contain duplicates',
      ctx,
    ),
  );

// Optional on create - InstrumentsService derives it from `name` via
// slugify() when omitted. Always required to already be in the right shape
// when the CMS does supply its own.
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, 'slug must be lowercase letters, digits and hyphens')
  .max(120)
  .optional();

export const createInstrumentSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(150),
  alternativeNames: alternativeNamesSchema,
  shortDescription: optionalNullableText(SHORT_DESCRIPTION_MAX_LENGTH),
  description: optionalNullableText(LONG_TEXT_MAX_LENGTH),
  history: optionalNullableText(LONG_TEXT_MAX_LENGTH),
  construction: optionalNullableText(LONG_TEXT_MAX_LENGTH),
  howToPlay: optionalNullableText(LONG_TEXT_MAX_LENGTH),
  roleInBateria: optionalNullableText(LONG_TEXT_MAX_LENGTH),
  displayOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  media: instrumentMediaListSchema,
});

export class CreateInstrumentDto extends createZodDto(createInstrumentSchema) {}

export type CreateInstrumentInput = z.infer<typeof createInstrumentSchema>;
export type { InstrumentMediaItemInput };
