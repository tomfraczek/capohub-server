import { Section } from '../../groups/entities/section.entity';
import { resolveDisplayName } from '../../users/display-name.util';
import { User } from '../../users/entities/user.entity';
import {
  MetronomeSequenceAuthorDto,
  MetronomeSequenceResponseDto,
  MetronomeSequenceSectionDto,
  SectionMetronomeSequenceResponseDto,
} from '../dto/metronome-sequence-response.dto';
import { MetronomeSequence } from '../entities/metronome-sequence.entity';
import { SectionMetronomeSequence } from '../entities/section-metronome-sequence.entity';

// The public name only (resolveDisplayName - the same rule as everywhere
// else); clerkUserId, email and the rest of the account never leave here.
function toAuthorDto(user: User): MetronomeSequenceAuthorDto {
  return { id: user.id, displayName: resolveDisplayName(user) };
}

export function toSectionDto(section: Section): MetronomeSequenceSectionDto {
  return { id: section.id, name: section.name };
}

// Requires `originalAuthor` populated.
export function toMetronomeSequenceResponseDto(
  sequence: MetronomeSequence,
  sharedInSections: MetronomeSequenceSectionDto[],
): MetronomeSequenceResponseDto {
  return {
    id: sequence.id,
    title: sequence.title,
    instrument: sequence.instrument,
    bpm: sequence.bpm,
    division: sequence.division,
    steps: sequence.steps,
    sharedInSections,
    originalAuthor: sequence.originalAuthor
      ? toAuthorDto(sequence.originalAuthor)
      : null,
    createdAt: sequence.createdAt.toISOString(),
    updatedAt: sequence.updatedAt.toISOString(),
  };
}

// Requires `sequence.owner` populated.
export function toSectionMetronomeSequenceResponseDto(
  share: SectionMetronomeSequence,
  viewerId: string,
  canRemove: boolean,
): SectionMetronomeSequenceResponseDto {
  const { sequence } = share;

  return {
    id: sequence.id,
    title: sequence.title,
    instrument: sequence.instrument,
    bpm: sequence.bpm,
    division: sequence.division,
    steps: sequence.steps,
    author: toAuthorDto(sequence.owner),
    sharedAt: share.createdAt.toISOString(),
    isOwn: sequence.owner.id === viewerId,
    canRemove,
  };
}
