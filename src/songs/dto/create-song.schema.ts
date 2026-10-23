import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { SongMediaProvider } from '../enums/song-media-provider.enum';
import { SongPerformer } from '../enums/song-performer.enum';
import { isValidMediaUrlForProvider } from './song-media-domains';
import {
  checkNoDuplicates,
  checkSequentialPositions,
  enumValuesSchema,
  languageCodeSchema,
  optionalNullableText,
  uuidSchema,
} from './song-validation.helpers';

const MAX_ALTERNATIVE_TITLES = 20;
const MAX_TAGS = 20;
const MAX_PARTS = 200;
const MAX_LINES_PER_PART = 100;
const MAX_MEDIA = 30;

const titleSchema = z.string().trim().min(1).max(200);

const alternativeTitleItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    position: z.number().int().min(1),
  })
  .strict();

const alternativeTitlesSchema = z
  .array(alternativeTitleItemSchema)
  .max(MAX_ALTERNATIVE_TITLES)
  .default([])
  .superRefine((items, ctx) => {
    checkSequentialPositions(items, ctx);
    checkNoDuplicates(
      items,
      (item) => item.title,
      'alternative titles must not contain duplicates',
      ctx,
    );
  });

const tagIdsSchema = z
  .array(uuidSchema)
  .max(MAX_TAGS)
  .default([])
  .superRefine((items, ctx) => {
    checkNoDuplicates(
      items,
      (item) => item,
      'tagIds must not contain duplicates',
      ctx,
    );
  });

// isUncertain is deliberately optional rather than .default(false): an
// older client that doesn't know the flag yet omits it, and an omitted
// flag must not silently clear one already set on the same translation -
// see SongContentService.replaceContent for how it is resolved.
const translationItemSchema = z
  .object({
    languageCode: languageCodeSchema,
    text: z.string().trim().min(1).max(5000),
    isUncertain: z.boolean().optional(),
  })
  .strict();

const translationsSchema = z
  .array(translationItemSchema)
  .default([])
  .superRefine((items, ctx) => {
    checkNoDuplicates(
      items,
      (item) => item.languageCode,
      'translations must not contain duplicate languageCode values',
      ctx,
    );
  });

// One phonetic transcription per language a moderator/author has filled in
// (mirrors translationItemSchema/translationsSchema exactly) - never a
// single flat phoneticText, since the same Portuguese line reads
// differently depending on the reader's own language.
const phoneticItemSchema = z
  .object({
    languageCode: languageCodeSchema,
    text: z.string().trim().min(1).max(2000),
  })
  .strict();

const phoneticsSchema = z
  .array(phoneticItemSchema)
  .default([])
  .superRefine((items, ctx) => {
    checkNoDuplicates(
      items,
      (item) => item.languageCode,
      'phonetics must not contain duplicate languageCode values',
      ctx,
    );
  });

const lineItemSchema = z
  .object({
    originalText: z.string().trim().min(1).max(2000),
    position: z.number().int().min(1),
    phonetics: phoneticsSchema,
    translations: translationsSchema,
  })
  .strict();

const linesSchema = z
  .array(lineItemSchema)
  .min(1, 'A part must have at least one line')
  .max(MAX_LINES_PER_PART)
  .superRefine(checkSequentialPositions);

const partItemSchema = z
  .object({
    performer: enumValuesSchema(Object.values(SongPerformer)),
    position: z.number().int().min(1),
    lines: linesSchema,
  })
  .strict();

const partsSchema = z
  .array(partItemSchema)
  .min(1, 'A song must have at least one part')
  .max(MAX_PARTS)
  .superRefine(checkSequentialPositions);

const mediaItemSchema = z
  .object({
    provider: enumValuesSchema(Object.values(SongMediaProvider)),
    url: z.string().trim().max(2048).url(),
    title: optionalNullableText(200),
    position: z.number().int().min(1),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (!isValidMediaUrlForProvider(item.provider, item.url)) {
      ctx.addIssue({
        code: 'custom',
        message: 'URL must be an https link on a domain matching the provider',
        path: ['url'],
      });
    }
  });

const mediaSchema = z
  .array(mediaItemSchema)
  .max(MAX_MEDIA)
  .default([])
  .superRefine((items, ctx) => {
    checkSequentialPositions(items, ctx);
    checkNoDuplicates(
      items,
      (item) => item.url,
      'media must not contain duplicate URLs',
      ctx,
    );
  });

// Shared by POST /songs (create) and PATCH /songs/:id (full replace-all
// update) - see docs/api-conventions.md and the Etap 8.2 report for why one
// schema covers both. status, createdBy and isVerified are deliberately
// absent, and .strict() rejects them outright if a client sends them.
export const createSongSchema = z
  .object({
    title: titleSchema,
    authorName: optionalNullableText(150),
    categoryId: uuidSchema,
    alternativeTitles: alternativeTitlesSchema,
    tagIds: tagIdsSchema,
    parts: partsSchema,
    media: mediaSchema,
    meaningHistory: optionalNullableText(10000),
    meaningContext: optionalNullableText(10000),
    meaningTrivia: optionalNullableText(10000),
  })
  .strict();

export class CreateSongDto extends createZodDto(createSongSchema) {}

export type CreateSongInput = z.infer<typeof createSongSchema>;
export type CreateSongAlternativeTitleInput = z.infer<
  typeof alternativeTitleItemSchema
>;
export type CreateSongPartInput = z.infer<typeof partItemSchema>;
export type CreateSongLineInput = z.infer<typeof lineItemSchema>;
export type CreateSongTranslationInput = z.infer<typeof translationItemSchema>;
export type CreateSongPhoneticInput = z.infer<typeof phoneticItemSchema>;
export type CreateSongMediaInput = z.infer<typeof mediaItemSchema>;
