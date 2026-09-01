import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import {
  booleanQuerySchema,
  optionalTrimmedStringQuerySchema,
  uuidQuerySchema,
} from '../../common/validation/query.schemas';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  enumValuesSchema,
  LANGUAGE_CODE_PATTERN,
} from './song-validation.helpers';

export const SONG_SORT_VALUES = [
  'title',
  '-title',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt',
] as const;

const translationLanguageQuerySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(10)
  .regex(
    LANGUAGE_CODE_PATTERN,
    'Must be a valid language code (e.g. "pl", "pt-br")',
  )
  .optional();

// tagIds arrives as a single comma-separated query param, e.g.
// ?tagIds=uuid1,uuid2. Duplicates are silently deduplicated; each id must be
// a valid UUID or the whole param is rejected.
const tagIdsQuerySchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  )
  .pipe(z.array(z.string().uuid('Each tag id must be a valid UUID')))
  .transform((ids) => Array.from(new Set(ids)))
  .optional();

// GET /songs is the public songbook - it always shows PUBLISHED songs only
// (see applyVisibility in songs-list-query.ts), so there is deliberately no
// `status` filter here: a caller can never ask this endpoint for
// DRAFT/PENDING_REVIEW/REJECTED/HIDDEN, regardless of globalRole. See
// GET /songs/my-submissions for a caller's own non-published songs and
// GET /moderation/songs for the moderation queue.
export const listSongsQuerySchema = paginationQuerySchema.extend({
  search: optionalTrimmedStringQuerySchema,
  categoryId: uuidQuerySchema.optional(),
  tagIds: tagIdsQuerySchema,
  hasTranslation: booleanQuerySchema.optional(),
  translationLanguage: translationLanguageQuerySchema,
  hasPhonetics: booleanQuerySchema.optional(),
  hasMedia: booleanQuerySchema.optional(),
  createdByMe: booleanQuerySchema.optional(),
  sort: enumValuesSchema(SONG_SORT_VALUES).default('-createdAt'),
});

export class ListSongsQueryDto extends createZodDto(listSongsQuerySchema) {}

export type ListSongsQuery = z.infer<typeof listSongsQuerySchema>;
