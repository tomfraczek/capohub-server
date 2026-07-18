import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createInstrumentSchema } from './create-instrument.schema';

// PATCH /admin/instruments/:id takes the same full target structure as
// POST /admin/instruments and replaces every field/child collection
// wholesale - there is no partial/diff update (mirrors update-song.schema.ts).
// The only per-field difference is behavioral, not structural: when `slug`
// is omitted, InstrumentsService keeps the existing slug instead of
// deriving a new one from `name` (see spec section 11 - slugs never change
// silently on rename).
export const updateInstrumentSchema = createInstrumentSchema;

export class UpdateInstrumentDto extends createZodDto(updateInstrumentSchema) {}

export type UpdateInstrumentInput = z.infer<typeof updateInstrumentSchema>;
