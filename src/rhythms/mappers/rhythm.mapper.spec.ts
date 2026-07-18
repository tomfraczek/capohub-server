import { Collection } from '@mikro-orm/core';
import { MusicMediaType } from '../../common/enums/music-media-type.enum';
import { Instrument } from '../../instruments/entities/instrument.entity';
import { RhythmMedia } from '../entities/rhythm-media.entity';
import { Rhythm } from '../entities/rhythm.entity';
import {
  toAdminRhythmListItemDto,
  toRhythmDetailsResponseDto,
  toRhythmListItemResponseDto,
  toRhythmMediaResponseDto,
} from './rhythm.mapper';

function buildRhythm(overrides: Partial<Rhythm> = {}): Rhythm {
  const rhythm = new Rhythm();
  rhythm.id = 'rhythm-1';
  rhythm.slug = 'sao-bento-grande';
  rhythm.name = 'São Bento Grande';
  rhythm.alternativeNames = [];
  rhythm.shortDescription = 'A slow, ceremonial rhythm';
  rhythm.description = 'Full description';
  rhythm.history = 'History';
  rhythm.usage = 'Usage';
  rhythm.character = 'Character';
  rhythm.tempoDescription = 'Slow';
  rhythm.tempoMinBpm = 60;
  rhythm.tempoMaxBpm = 90;
  rhythm.displayOrder = 1;
  rhythm.isActive = true;
  rhythm.media = new Collection<RhythmMedia>(rhythm, []);
  rhythm.createdAt = new Date('2026-01-01T00:00:00.000Z');
  rhythm.updatedAt = new Date('2026-01-02T00:00:00.000Z');
  return Object.assign(rhythm, overrides);
}

function buildMedia(overrides: Partial<RhythmMedia> = {}): RhythmMedia {
  const media = new RhythmMedia();
  media.id = 'media-1';
  media.type = MusicMediaType.VIDEO;
  media.url = 'https://example.com/video.mp4';
  media.title = null;
  media.description = null;
  media.displayOrder = 1;
  media.instrument = null;
  return Object.assign(media, overrides);
}

describe('rhythm.mapper', () => {
  describe('toRhythmMediaResponseDto', () => {
    it('maps instrumentId to null when no instrument is set', () => {
      const media = buildMedia();
      expect(toRhythmMediaResponseDto(media).instrumentId).toBeNull();
    });

    it('maps instrumentId when an instrument is set', () => {
      const instrument = new Instrument();
      instrument.id = 'instrument-1';
      const media = buildMedia({ instrument });

      expect(toRhythmMediaResponseDto(media).instrumentId).toBe('instrument-1');
    });
  });

  describe('toRhythmListItemResponseDto', () => {
    it('uses the first media item (by displayOrder) as primaryMedia', () => {
      const rhythm = buildRhythm();
      const media1 = buildMedia({ id: 'media-1', displayOrder: 1 });
      const media2 = buildMedia({ id: 'media-2', displayOrder: 2 });
      rhythm.media = new Collection<RhythmMedia>(rhythm, [media1, media2]);

      expect(toRhythmListItemResponseDto(rhythm).primaryMedia?.id).toBe(
        'media-1',
      );
    });

    it('includes tempo fields but not the long-form content fields', () => {
      const rhythm = buildRhythm();
      const dto = toRhythmListItemResponseDto(rhythm);

      expect(dto.tempoMinBpm).toBe(60);
      expect(dto.tempoMaxBpm).toBe(90);
      expect(dto).not.toHaveProperty('history');
      expect(dto).not.toHaveProperty('usage');
    });
  });

  describe('toRhythmDetailsResponseDto', () => {
    it('maps every field, including externally-computed instruments and songs', () => {
      const rhythm = buildRhythm();
      const instruments = [
        {
          id: 'instrument-1',
          slug: 'berimbau',
          name: 'Berimbau',
          shortDescription: null,
          roleDescription: 'Leads',
          displayOrder: 1,
        },
      ];
      const songs = [
        {
          id: 'song-1',
          title: 'Paranauê',
          authorName: null,
          status: 'PUBLISHED',
          category: {
            id: 'cat-1',
            code: 'CORRIDO',
            name: 'Corrido',
            position: 1,
          },
          tags: [],
          hasPhonetics: false,
          translationLanguages: [],
          hasMedia: false,
          createdBy: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          isPrimary: true,
          relationDescription: null,
        },
      ] as never;

      const dto = toRhythmDetailsResponseDto(rhythm, instruments, songs);

      expect(dto).toMatchObject({
        id: 'rhythm-1',
        slug: 'sao-bento-grande',
        tempoMinBpm: 60,
        tempoMaxBpm: 90,
        instruments,
        songs,
      });
    });
  });

  describe('toAdminRhythmListItemDto', () => {
    it('maps only the admin list fields', () => {
      const rhythm = buildRhythm({ isActive: false });
      expect(toAdminRhythmListItemDto(rhythm)).toEqual({
        id: 'rhythm-1',
        slug: 'sao-bento-grande',
        name: 'São Bento Grande',
        displayOrder: 1,
        isActive: false,
      });
    });
  });
});
