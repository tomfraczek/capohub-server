import { Collection } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DuplicateCandidateRow } from './duplicate-suggestions.query';
import { SongLine } from './entities/song-line.entity';
import { SongPart } from './entities/song-part.entity';
import { Song } from './entities/song.entity';
import { SongPerformer } from './enums/song-performer.enum';
import { SongStatus } from './enums/song-status.enum';
import { SongDuplicateService } from './song-duplicate.service';

const queryDuplicateCandidatesMock = jest.fn<
  Promise<DuplicateCandidateRow[]>,
  [unknown, unknown]
>();

jest.mock('./duplicate-suggestions.query', () => ({
  queryDuplicateCandidates: (
    em: unknown,
    params: unknown,
  ): Promise<DuplicateCandidateRow[]> =>
    queryDuplicateCandidatesMock(em, params),
}));

function buildCandidate(
  overrides: Partial<DuplicateCandidateRow> = {},
): DuplicateCandidateRow {
  return {
    id: 'candidate-id',
    title: 'Paranauê',
    status: SongStatus.PUBLISHED,
    firstLine: 'Paranauê, paranauê Paraná',
    ...overrides,
  };
}

function buildSongWithFirstLine(title: string, firstLine: string | null): Song {
  const song = new Song();
  song.id = 'current-song-id';
  song.title = title;

  const part = new SongPart();
  part.song = song;
  part.performer = SongPerformer.LEAD;
  part.position = 1;

  if (firstLine !== null) {
    const line = new SongLine();
    line.part = part;
    line.originalText = firstLine;
    line.position = 1;
    part.lines = new Collection<SongLine>(part, [line]);
  } else {
    part.lines = new Collection<SongLine>(part, []);
  }

  song.parts = new Collection<SongPart>(song, [part]);
  return song;
}

const fakeEm = {} as unknown as EntityManager;

describe('SongDuplicateService', () => {
  beforeEach(() => {
    queryDuplicateCandidatesMock.mockReset();
    queryDuplicateCandidatesMock.mockResolvedValue([]);
  });

  describe('findSuggestions', () => {
    it('returns an empty list without querying when the title is shorter than 3 characters', async () => {
      const service = new SongDuplicateService();

      const result = await service.findSuggestions(fakeEm, 'user-1', 'pa', 5);

      expect(result).toEqual([]);
      expect(queryDuplicateCandidatesMock).not.toHaveBeenCalled();
    });

    it('returns an empty list for a title that is only whitespace padding around <3 chars', async () => {
      const service = new SongDuplicateService();

      const result = await service.findSuggestions(
        fakeEm,
        'user-1',
        '  a  ',
        5,
      );

      expect(result).toEqual([]);
      expect(queryDuplicateCandidatesMock).not.toHaveBeenCalled();
    });

    it('excludes candidates below the suggestion similarity threshold', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({ id: 'close', title: 'Paranauê' }),
        buildCandidate({ id: 'far', title: 'Completely unrelated title' }),
      ]);
      const service = new SongDuplicateService();

      const result = await service.findSuggestions(
        fakeEm,
        'user-1',
        'Paranauê',
        5,
      );

      expect(result.map((item) => item.id)).toEqual(['close']);
    });

    it('maps candidate rows to the minimal suggestion DTO shape', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({
          id: 'song-1',
          title: 'Paranauê',
          status: SongStatus.PUBLISHED,
          firstLine: 'Paranauê, paranauê Paraná',
        }),
      ]);
      const service = new SongDuplicateService();

      const [result] = await service.findSuggestions(
        fakeEm,
        'user-1',
        'Paranauê',
        5,
      );

      expect(result).toEqual({
        id: 'song-1',
        title: 'Paranauê',
        firstLine: 'Paranauê, paranauê Paraná',
        status: SongStatus.PUBLISHED,
        similarity: 1,
      });
    });

    it('respects the limit parameter', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({ id: 'a', title: 'Paranauê' }),
        buildCandidate({ id: 'b', title: 'Paranaue' }),
        buildCandidate({ id: 'c', title: 'paranaue' }),
      ]);
      const service = new SongDuplicateService();

      const result = await service.findSuggestions(
        fakeEm,
        'user-1',
        'Paranauê',
        2,
      );

      expect(result).toHaveLength(2);
    });

    it('passes the trimmed title and currentUserId through to the candidate query', async () => {
      const service = new SongDuplicateService();

      await service.findSuggestions(fakeEm, 'user-42', '  Paranauê  ', 5);

      expect(queryDuplicateCandidatesMock).toHaveBeenCalledWith(fakeEm, {
        currentUserId: 'user-42',
        searchTerm: 'Paranauê',
        excludeSongId: undefined,
      });
    });
  });

  describe('findBlockingDuplicates', () => {
    it('returns no duplicates when nothing meets the blocking threshold', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({
          id: 'other',
          title: 'Completely different song',
          firstLine: 'Something else entirely',
        }),
      ]);
      const service = new SongDuplicateService();
      const currentSong = buildSongWithFirstLine(
        'Paranauê',
        'Paranauê, paranauê Paraná',
      );

      const result = await service.findBlockingDuplicates(
        fakeEm,
        'user-1',
        currentSong,
      );

      expect(result).toEqual([]);
    });

    it('blocks on identical title + identical first line (rule A)', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({
          id: 'duplicate-id',
          title: 'Paranauê',
          status: SongStatus.PUBLISHED,
          firstLine: 'Paranauê, paranauê Paraná',
        }),
      ]);
      const service = new SongDuplicateService();
      const currentSong = buildSongWithFirstLine(
        'Paranauê',
        'Paranauê, paranauê Paraná',
      );

      const result = await service.findBlockingDuplicates(
        fakeEm,
        'user-1',
        currentSong,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'duplicate-id',
        status: SongStatus.PUBLISHED,
      });
      expect(result[0].similarity).toBeGreaterThanOrEqual(0.95);
    });

    it('does not block on identical title with clearly different lyrics (rule C)', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({
          id: 'same-title-different-song',
          title: 'Paranauê',
          firstLine: 'Uma historia completamente diferente aqui',
        }),
      ]);
      const service = new SongDuplicateService();
      const currentSong = buildSongWithFirstLine(
        'Paranauê',
        'Paranauê, paranauê Paraná',
      );

      const result = await service.findBlockingDuplicates(
        fakeEm,
        'user-1',
        currentSong,
      );

      expect(result).toEqual([]);
    });

    it('does not produce a false positive when the current song has no lyric lines yet', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({
          id: 'other',
          title: 'Paranauê',
          firstLine: 'Paranauê, paranauê Paraná',
        }),
      ]);
      const service = new SongDuplicateService();
      const currentSong = buildSongWithFirstLine('Paranauê', null);

      const result = await service.findBlockingDuplicates(
        fakeEm,
        'user-1',
        currentSong,
      );

      expect(result).toEqual([]);
    });

    it('excludes the current song from candidates via excludeSongId', async () => {
      const service = new SongDuplicateService();
      const currentSong = buildSongWithFirstLine(
        'Paranauê',
        'Paranauê, paranauê Paraná',
      );

      await service.findBlockingDuplicates(fakeEm, 'user-1', currentSong);

      expect(queryDuplicateCandidatesMock).toHaveBeenCalledWith(fakeEm, {
        currentUserId: 'user-1',
        searchTerm: 'Paranauê',
        excludeSongId: 'current-song-id',
      });
    });

    it('returns at most 3 blocking duplicates', async () => {
      queryDuplicateCandidatesMock.mockResolvedValue([
        buildCandidate({ id: 'a', title: 'Paranauê' }),
        buildCandidate({ id: 'b', title: 'Paranauê' }),
        buildCandidate({ id: 'c', title: 'Paranauê' }),
        buildCandidate({ id: 'd', title: 'Paranauê' }),
      ]);
      const service = new SongDuplicateService();
      const currentSong = buildSongWithFirstLine(
        'Paranauê',
        'Paranauê, paranauê Paraná',
      );

      const result = await service.findBlockingDuplicates(
        fakeEm,
        'user-1',
        currentSong,
      );

      expect(result.length).toBeLessThanOrEqual(3);
    });
  });
});
