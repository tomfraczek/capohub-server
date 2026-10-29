// The shape of a metronome sequence, mirrored from the mobile app's
// Instrumenty mode (capohub-mobile instrument-config.ts): a cycle of four
// pulses stored as 16 fine steps, shown at a division of 4, 8 or 16. Any
// change here must match the app, which validates the same rules offline.

export const METRONOME_INSTRUMENTS = ['agogo', 'atabaque'] as const;
export type MetronomeInstrument = (typeof METRONOME_INSTRUMENTS)[number];

export const METRONOME_INSTRUMENT_SOUNDS: Record<
  MetronomeInstrument,
  readonly string[]
> = {
  agogo: ['low', 'high'],
  atabaque: ['bass', 'open', 'slap'],
};

export const METRONOME_REST = 'rest';

export const METRONOME_DIVISIONS = [4, 8, 16] as const;
export const METRONOME_FINE_STEPS = 16;

export const METRONOME_MIN_BPM = 40;
export const METRONOME_MAX_BPM = 300;

export const METRONOME_TITLE_MAX_LENGTH = 80;

// Keeps one account's library (and the unpaginated "mine" list) bounded.
export const METRONOME_MAX_SEQUENCES_PER_USER = 200;

export type MetronomeStep = {
  sound: string;
  muted: boolean;
};
