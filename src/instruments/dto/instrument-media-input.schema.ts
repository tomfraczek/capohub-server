import { z } from 'zod';
import {
  checkSequentialPositions,
  optionalNullableText,
} from '../../songs/dto/song-validation.helpers';
import { MusicMediaType } from '../../common/enums/music-media-type.enum';

const MAX_MEDIA = 50;

export const instrumentMediaItemSchema = z
  .object({
    type: z.nativeEnum(MusicMediaType),
    url: z.string().trim().url().max(2048),
    title: optionalNullableText(200),
    description: optionalNullableText(5000),
    displayOrder: z.number().int().min(1),
  })
  .strict();

export const instrumentMediaListSchema = z
  .array(instrumentMediaItemSchema)
  .max(MAX_MEDIA)
  .default([])
  .superRefine((items, ctx) => {
    checkSequentialPositions(
      items.map((item) => ({ position: item.displayOrder })),
      ctx,
    );
  });

export type InstrumentMediaItemInput = z.infer<
  typeof instrumentMediaItemSchema
>;
