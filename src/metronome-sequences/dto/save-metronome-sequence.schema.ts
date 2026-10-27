import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  METRONOME_FINE_STEPS,
  METRONOME_INSTRUMENT_SOUNDS,
  METRONOME_INSTRUMENTS,
  METRONOME_MAX_BPM,
  METRONOME_MIN_BPM,
  METRONOME_REST,
  METRONOME_TITLE_MAX_LENGTH,
} from '../metronome-sequence.constants';

const stepSchema = z.object({
  sound: z.string(),
  muted: z.boolean(),
});

// The full sequence - PUT /metronome-sequences/:id replaces it as a whole
// (create-or-replace), which is what lets the app retry a save made offline
// without ever creating a duplicate. Unknown keys are dropped, so an older
// app still sending the retired `visibility` field keeps working.
export const saveMetronomeSequenceSchema = z
  .object({
    title: z.string().trim().min(1).max(METRONOME_TITLE_MAX_LENGTH),
    instrument: z.enum(METRONOME_INSTRUMENTS),
    bpm: z.number().int().min(METRONOME_MIN_BPM).max(METRONOME_MAX_BPM),
    division: z.union([z.literal(4), z.literal(8), z.literal(16)]),
    steps: z.array(stepSchema).length(METRONOME_FINE_STEPS),
  })
  .superRefine((value, ctx) => {
    const sounds = METRONOME_INSTRUMENT_SOUNDS[value.instrument];

    value.steps.forEach((step, index) => {
      if (step.sound !== METRONOME_REST && !sounds.includes(step.sound)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'sound'],
          message: `Unknown ${value.instrument} sound "${step.sound}"`,
        });
      }
    });
  });

export class SaveMetronomeSequenceDto extends createZodDto(
  saveMetronomeSequenceSchema,
) {}

export type SaveMetronomeSequenceInput = z.infer<
  typeof saveMetronomeSequenceSchema
>;
