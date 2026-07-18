import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { SLUG_PATTERN } from '../../common/utils/slugify';
import {
  checkNoDuplicates,
  optionalNullableText,
} from '../../songs/dto/song-validation.helpers';
import { instrumentLinkListSchema } from './instrument-link-input.schema';
import { rhythmMediaListSchema } from './rhythm-media-input.schema';
import { songLinkListSchema } from './song-link-input.schema';

const MAX_ALTERNATIVE_NAMES = 30;
const SHORT_DESCRIPTION_MAX_LENGTH = 300;
const TEMPO_DESCRIPTION_MAX_LENGTH = 300;
// Educational content is expected to be long-form - no arbitrarily low
// limit (spec section 14).
const LONG_TEXT_MAX_LENGTH = 20000;
const MIN_BPM = 1;
const MAX_BPM = 400;

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

// Optional on create - RhythmsService derives it from `name` via slugify()
// when omitted.
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, 'slug must be lowercase letters, digits and hyphens')
  .max(120)
  .optional();

const bpmSchema = z
  .number()
  .int()
  .min(MIN_BPM)
  .max(MAX_BPM)
  .nullish()
  .transform((value) => value ?? null);

export const createRhythmSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(150),
    alternativeNames: alternativeNamesSchema,
    shortDescription: optionalNullableText(SHORT_DESCRIPTION_MAX_LENGTH),
    description: optionalNullableText(LONG_TEXT_MAX_LENGTH),
    history: optionalNullableText(LONG_TEXT_MAX_LENGTH),
    usage: optionalNullableText(LONG_TEXT_MAX_LENGTH),
    character: optionalNullableText(LONG_TEXT_MAX_LENGTH),
    tempoDescription: optionalNullableText(TEMPO_DESCRIPTION_MAX_LENGTH),
    tempoMinBpm: bpmSchema,
    tempoMaxBpm: bpmSchema,
    displayOrder: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
    media: rhythmMediaListSchema,
    instrumentLinks: instrumentLinkListSchema,
    songLinks: songLinkListSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.tempoMinBpm !== null &&
      value.tempoMaxBpm !== null &&
      value.tempoMinBpm > value.tempoMaxBpm
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'tempoMinBpm must not be greater than tempoMaxBpm',
        path: ['tempoMinBpm'],
      });
    }
  });

export class CreateRhythmDto extends createZodDto(createRhythmSchema) {}

export type CreateRhythmInput = z.infer<typeof createRhythmSchema>;
