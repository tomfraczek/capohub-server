import { AdminInstrumentListItemDto } from '../dto/admin-instrument-list-item.dto';
import { InstrumentDetailsResponseDto } from '../dto/instrument-details-response.dto';
import { InstrumentListItemResponseDto } from '../dto/instrument-list-item-response.dto';
import { InstrumentMediaResponseDto } from '../dto/instrument-media-response.dto';
import { InstrumentRhythmRefDto } from '../dto/instrument-rhythm-ref.dto';
import { InstrumentMedia } from '../entities/instrument-media.entity';
import { Instrument } from '../entities/instrument.entity';

export function toInstrumentMediaResponseDto(
  media: InstrumentMedia,
): InstrumentMediaResponseDto {
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    title: media.title,
    description: media.description,
    displayOrder: media.displayOrder,
  };
}

/**
 * Maps an Instrument (media populated) to the GET /instruments list row.
 * `primaryMedia` is the first item by displayOrder - Instrument.media is
 * already ordered that way at the ORM level (see Instrument.media's
 * orderBy option), so no sorting happens here.
 */
export function toInstrumentListItemResponseDto(
  instrument: Instrument,
): InstrumentListItemResponseDto {
  const media = instrument.media.getItems();

  return {
    id: instrument.id,
    slug: instrument.slug,
    name: instrument.name,
    alternativeNames: instrument.alternativeNames,
    shortDescription: instrument.shortDescription,
    primaryMedia:
      media.length > 0 ? toInstrumentMediaResponseDto(media[0]) : null,
  };
}

/**
 * Maps an Instrument (media populated) plus separately-computed related
 * rhythms to the GET /instruments/:slug (and admin equivalent) response
 * shape - see InstrumentsService for how `rhythms` is computed.
 */
export function toInstrumentDetailsResponseDto(
  instrument: Instrument,
  rhythms: InstrumentRhythmRefDto[],
): InstrumentDetailsResponseDto {
  return {
    id: instrument.id,
    slug: instrument.slug,
    name: instrument.name,
    alternativeNames: instrument.alternativeNames,
    shortDescription: instrument.shortDescription,
    description: instrument.description,
    history: instrument.history,
    construction: instrument.construction,
    howToPlay: instrument.howToPlay,
    roleInBateria: instrument.roleInBateria,
    displayOrder: instrument.displayOrder,
    isActive: instrument.isActive,
    media: instrument.media.getItems().map(toInstrumentMediaResponseDto),
    rhythms,
    createdAt: instrument.createdAt.toISOString(),
    updatedAt: instrument.updatedAt.toISOString(),
  };
}

export function toAdminInstrumentListItemDto(
  instrument: Instrument,
): AdminInstrumentListItemDto {
  return {
    id: instrument.id,
    slug: instrument.slug,
    name: instrument.name,
    displayOrder: instrument.displayOrder,
    isActive: instrument.isActive,
  };
}
