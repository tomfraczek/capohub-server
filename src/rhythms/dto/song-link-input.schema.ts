import { z } from 'zod';
import {
  checkNoDuplicates,
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';

const MAX_SONG_LINKS = 200;

export const songLinkItemSchema = z
  .object({
    songId: uuidSchema,
    isPrimary: z.boolean().default(false),
    description: optionalNullableText(2000),
  })
  .strict();

// "At most one primary rhythm per song" is NOT checked here: it's a
// cross-rhythm invariant (a single rhythm can legitimately be the primary
// rhythm of many different songs - what's capped at one is, per song, how
// many of its rhythms are marked primary). That can only be verified
// against the database, so RhythmsService enforces it transactionally when
// applying songLinks - see replaceSongLinks.
export const songLinkListSchema = z
  .array(songLinkItemSchema)
  .max(MAX_SONG_LINKS)
  .default([])
  .superRefine((items, ctx) =>
    checkNoDuplicates(
      items,
      (item) => item.songId,
      'songLinks must not reference the same song twice',
      ctx,
    ),
  );

export type SongLinkItemInput = z.infer<typeof songLinkItemSchema>;
