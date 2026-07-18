import { Collection } from '@mikro-orm/core';
import { MusicMediaType } from '../../common/enums/music-media-type.enum';
import { InstrumentMedia } from '../entities/instrument-media.entity';
import { Instrument } from '../entities/instrument.entity';
import {
  toAdminInstrumentListItemDto,
  toInstrumentDetailsResponseDto,
  toInstrumentListItemResponseDto,
  toInstrumentMediaResponseDto,
} from './instrument.mapper';

function buildInstrument(overrides: Partial<Instrument> = {}): Instrument {
  const instrument = new Instrument();
  instrument.id = 'instrument-1';
  instrument.slug = 'berimbau';
  instrument.name = 'Berimbau';
  instrument.alternativeNames = ['Berimbau de barriga'];
  instrument.shortDescription = 'The lead instrument';
  instrument.description = 'Full description';
  instrument.history = 'History';
  instrument.construction = 'Construction';
  instrument.howToPlay = 'How to play';
  instrument.roleInBateria = 'Leads the roda';
  instrument.displayOrder = 1;
  instrument.isActive = true;
  instrument.media = new Collection<InstrumentMedia>(instrument, []);
  instrument.createdAt = new Date('2026-01-01T00:00:00.000Z');
  instrument.updatedAt = new Date('2026-01-02T00:00:00.000Z');
  return Object.assign(instrument, overrides);
}

function buildMedia(overrides: Partial<InstrumentMedia> = {}): InstrumentMedia {
  const media = new InstrumentMedia();
  media.id = 'media-1';
  media.type = MusicMediaType.IMAGE;
  media.url = 'https://example.com/berimbau.jpg';
  media.title = 'A berimbau';
  media.description = null;
  media.displayOrder = 1;
  return Object.assign(media, overrides);
}

describe('instrument.mapper', () => {
  describe('toInstrumentMediaResponseDto', () => {
    it('maps every field 1:1', () => {
      const media = buildMedia();
      expect(toInstrumentMediaResponseDto(media)).toEqual({
        id: 'media-1',
        type: MusicMediaType.IMAGE,
        url: 'https://example.com/berimbau.jpg',
        title: 'A berimbau',
        description: null,
        displayOrder: 1,
      });
    });
  });

  describe('toInstrumentListItemResponseDto', () => {
    it('uses the first media item (by displayOrder) as primaryMedia', () => {
      const instrument = buildInstrument();
      const media1 = buildMedia({ id: 'media-1', displayOrder: 1 });
      const media2 = buildMedia({ id: 'media-2', displayOrder: 2 });
      instrument.media = new Collection<InstrumentMedia>(instrument, [
        media1,
        media2,
      ]);

      const dto = toInstrumentListItemResponseDto(instrument);

      expect(dto.primaryMedia?.id).toBe('media-1');
    });

    it('sets primaryMedia to null when there is no media', () => {
      const instrument = buildInstrument();
      expect(
        toInstrumentListItemResponseDto(instrument).primaryMedia,
      ).toBeNull();
    });

    it('never includes description/history/construction fields', () => {
      const instrument = buildInstrument();
      const dto = toInstrumentListItemResponseDto(instrument);

      expect(dto).not.toHaveProperty('description');
      expect(dto).not.toHaveProperty('history');
      expect(dto).not.toHaveProperty('construction');
    });
  });

  describe('toInstrumentDetailsResponseDto', () => {
    it('maps every field, including externally-computed rhythms', () => {
      const instrument = buildInstrument();
      const rhythms = [
        {
          id: 'rhythm-1',
          slug: 'sao-bento-grande',
          name: 'São Bento Grande',
          shortDescription: null,
          roleDescription: 'Leads the game',
          displayOrder: 1,
        },
      ];

      const dto = toInstrumentDetailsResponseDto(instrument, rhythms);

      expect(dto).toMatchObject({
        id: 'instrument-1',
        slug: 'berimbau',
        name: 'Berimbau',
        alternativeNames: ['Berimbau de barriga'],
        isActive: true,
        rhythms,
      });
      expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(dto.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    });
  });

  describe('toAdminInstrumentListItemDto', () => {
    it('maps only the admin list fields', () => {
      const instrument = buildInstrument({ isActive: false });
      expect(toAdminInstrumentListItemDto(instrument)).toEqual({
        id: 'instrument-1',
        slug: 'berimbau',
        name: 'Berimbau',
        displayOrder: 1,
        isActive: false,
      });
    });
  });
});
