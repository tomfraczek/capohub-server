import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import {
  booleanQuerySchema,
  optionalTrimmedStringQuerySchema,
  uuidQuerySchema,
} from '../../common/validation/query.schemas';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { SongStatus } from '../enums/song-status.enum';
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

// GET /songs is the public songbook - for anyone else's songs it always
// shows PUBLISHED only (see applyVisibility in songs-list-query.ts),
// regardless of globalRole or this `status` value. `status` only takes
// effect together with createdByMe=true - a caller filtering to their own
// songs may narrow by any status (mirrors GET /songs/my-submissions'
// DRAFT/PENDING_REVIEW/REJECTED, plus PUBLISHED/HIDDEN too, all reachable
// here through one list instead of a dedicated endpoint). See
// GET /moderation/songs for the moderation queue's own view across every
// user's PENDING_REVIEW/REJECTED songs.
const OWN_SONG_LIST_STATUSES = [
  SongStatus.DRAFT,
  SongStatus.PENDING_REVIEW,
  SongStatus.PUBLISHED,
  SongStatus.REJECTED,
  SongStatus.HIDDEN,
] as const;

export const listSongsQuerySchema = paginationQuerySchema.extend({
  search: optionalTrimmedStringQuerySchema,
  categoryId: uuidQuerySchema.optional(),
  tagIds: tagIdsQuerySchema,
  hasTranslation: booleanQuerySchema.optional(),
  translationLanguage: translationLanguageQuerySchema,
  hasPhonetics: booleanQuerySchema.optional(),
  hasMedia: booleanQuerySchema.optional(),
  createdByMe: booleanQuerySchema.optional(),
  status: enumValuesSchema(OWN_SONG_LIST_STATUSES).optional(),
  sort: enumValuesSchema(SONG_SORT_VALUES).default('-createdAt'),
});

export class ListSongsQueryDto extends createZodDto(listSongsQuerySchema) {}

export type ListSongsQuery = z.infer<typeof listSongsQuerySchema>;
