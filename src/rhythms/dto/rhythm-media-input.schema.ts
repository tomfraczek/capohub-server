import { z } from 'zod';
import { MusicMediaType } from '../../common/enums/music-media-type.enum';
import {
  checkSequentialPositions,
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';

const MAX_MEDIA = 50;

export const rhythmMediaItemSchema = z
  .object({
    type: z.nativeEnum(MusicMediaType),
    url: z.string().trim().url().max(2048),
    title: optionalNullableText(200),
    description: optionalNullableText(5000),
    displayOrder: z.number().int().min(1),
    // Optional: marks that this media demonstrates a specific instrument's
    // part within the rhythm (spec section 4). Existence is checked by
    // RhythmsService against the live instruments table, not here.
    instrumentId: uuidSchema.nullish().transform((value) => value ?? null),
  })
  .strict();

export const rhythmMediaListSchema = z
  .array(rhythmMediaItemSchema)
  .max(MAX_MEDIA)
  .default([])
  .superRefine((items, ctx) => {
    checkSequentialPositions(
      items.map((item) => ({ position: item.displayOrder })),
      ctx,
    );
  });

export type RhythmMediaItemInput = z.infer<typeof rhythmMediaItemSchema>;
