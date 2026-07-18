import { AdminRhythmListItemDto } from '../dto/admin-rhythm-list-item.dto';
import { RhythmDetailsResponseDto } from '../dto/rhythm-details-response.dto';
import { RhythmInstrumentRefDto } from '../dto/rhythm-instrument-ref.dto';
import { RhythmListItemResponseDto } from '../dto/rhythm-list-item-response.dto';
import { RhythmMediaResponseDto } from '../dto/rhythm-media-response.dto';
import { RhythmSongRefDto } from '../dto/rhythm-song-ref.dto';
import { RhythmMedia } from '../entities/rhythm-media.entity';
import { Rhythm } from '../entities/rhythm.entity';

export function toRhythmMediaResponseDto(
  media: RhythmMedia,
): RhythmMediaResponseDto {
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    title: media.title,
    description: media.description,
    displayOrder: media.displayOrder,
    instrumentId: media.instrument?.id ?? null,
  };
}

/**
 * Maps a Rhythm (media populated) to the GET /rhythms list row.
 * `primaryMedia` is the first item by displayOrder - Rhythm.media is
 * already ordered that way at the ORM level (see Rhythm.media's orderBy
 * option), so no sorting happens here.
 */
export function toRhythmListItemResponseDto(
  rhythm: Rhythm,
): RhythmListItemResponseDto {
  const media = rhythm.media.getItems();

  return {
    id: rhythm.id,
    slug: rhythm.slug,
    name: rhythm.name,
    alternativeNames: rhythm.alternativeNames,
    shortDescription: rhythm.shortDescription,
    tempoDescription: rhythm.tempoDescription,
    tempoMinBpm: rhythm.tempoMinBpm,
    tempoMaxBpm: rhythm.tempoMaxBpm,
    primaryMedia: media.length > 0 ? toRhythmMediaResponseDto(media[0]) : null,
  };
}

/**
 * Maps a Rhythm (media populated) plus separately-computed related
 * instruments/songs to the GET /rhythms/:slug (and admin equivalent)
 * response shape - see RhythmsService for how `instruments`/`songs` are
 * computed.
 */
export function toRhythmDetailsResponseDto(
  rhythm: Rhythm,
  instruments: RhythmInstrumentRefDto[],
  songs: RhythmSongRefDto[],
): RhythmDetailsResponseDto {
  return {
    id: rhythm.id,
    slug: rhythm.slug,
    name: rhythm.name,
    alternativeNames: rhythm.alternativeNames,
    shortDescription: rhythm.shortDescription,
    description: rhythm.description,
    history: rhythm.history,
    usage: rhythm.usage,
    character: rhythm.character,
    tempoDescription: rhythm.tempoDescription,
    tempoMinBpm: rhythm.tempoMinBpm,
    tempoMaxBpm: rhythm.tempoMaxBpm,
    displayOrder: rhythm.displayOrder,
    isActive: rhythm.isActive,
    media: rhythm.media.getItems().map(toRhythmMediaResponseDto),
    instruments,
    songs,
    createdAt: rhythm.createdAt.toISOString(),
    updatedAt: rhythm.updatedAt.toISOString(),
  };
}

export function toAdminRhythmListItemDto(
  rhythm: Rhythm,
): AdminRhythmListItemDto {
  return {
    id: rhythm.id,
    slug: rhythm.slug,
    name: rhythm.name,
    displayOrder: rhythm.displayOrder,
    isActive: rhythm.isActive,
  };
}
