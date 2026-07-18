import { z } from 'zod';
import {
  checkNoDuplicates,
  checkSequentialPositions,
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';

const MAX_INSTRUMENT_LINKS = 50;

export const instrumentLinkItemSchema = z
  .object({
    instrumentId: uuidSchema,
    roleDescription: optionalNullableText(5000),
    displayOrder: z.number().int().min(1),
  })
  .strict();

export const instrumentLinkListSchema = z
  .array(instrumentLinkItemSchema)
  .max(MAX_INSTRUMENT_LINKS)
  .default([])
  .superRefine((items, ctx) => {
    checkSequentialPositions(
      items.map((item) => ({ position: item.displayOrder })),
      ctx,
    );
    checkNoDuplicates(
      items,
      (item) => item.instrumentId,
      'instrumentLinks must not reference the same instrument twice',
      ctx,
    );
  });

export type InstrumentLinkItemInput = z.infer<typeof instrumentLinkItemSchema>;
