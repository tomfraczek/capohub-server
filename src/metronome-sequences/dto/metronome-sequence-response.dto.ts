import type {
  MetronomeInstrument,
  MetronomeStep,
} from '../metronome-sequence.constants';

export class MetronomeSequenceAuthorDto {
  id!: string;
  displayName!: string;
}

export class MetronomeSequenceSectionDto {
  id!: string;
  name!: string;
}

// One of the current user's own sequences.
export class MetronomeSequenceResponseDto {
  id!: string;
  title!: string;
  instrument!: MetronomeInstrument;
  bpm!: number;
  division!: number;
  steps!: MetronomeStep[];
  // Sections this sequence is shared in ("Udostępniono w:").
  sharedInSections!: MetronomeSequenceSectionDto[];
  // Who made the sequence this one was copied from, if it is a copy.
  originalAuthor!: MetronomeSequenceAuthorDto | null;
  createdAt!: string;
  updatedAt!: string;
}

// A sequence shared in a Section, as its members see it - with everything
// needed to play it straight from the list.
export class SectionMetronomeSequenceResponseDto {
  id!: string;
  title!: string;
  instrument!: MetronomeInstrument;
  bpm!: number;
  division!: number;
  steps!: MetronomeStep[];
  author!: MetronomeSequenceAuthorDto;
  sharedAt!: string;
  // The viewer's own sequence - "Zapisz u siebie" makes no sense.
  isOwn!: boolean;
  // The viewer may remove it from this Section (Section OWNER/ADMIN).
  canRemove!: boolean;
}
