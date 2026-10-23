import { join } from 'node:path';
import { SongStatus } from '../../../songs/enums/song-status.enum';
import {
  countRecord,
  decideImportAction,
  ExistingSongCandidate,
  loadSongImportFiles,
  SongImportStatus,
} from './song-import';
import {
  SongImportRecord,
  validateSongImportDataset,
} from './song-import.schema';
import {
  diffSnapshots,
  snapshotFromRecord,
  SongContentSnapshot,
} from './song-import.snapshot';

const { entries } = validateSongImportDataset(
  loadSongImportFiles(join(__dirname, '../../../../songs')),
);

function recordTitled(title: string): SongImportRecord {
  return entries.find((entry) => entry.record.title === title)!.record;
}

function candidate(
  snapshot: SongContentSnapshot,
  songId = 'existing-id',
): ExistingSongCandidate {
  return { songId, status: SongStatus.PUBLISHED, snapshot };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('song import decisions', () => {
  const paranaue = snapshotFromRecord(recordTitled('Paranauê'));

  it('creates a song when nothing shares its titles', () => {
    expect(decideImportAction(paranaue, [])).toEqual({ action: 'CREATE' });
  });

  it('skips a song whose identical content already exists (idempotent re-run)', () => {
    const decision = decideImportAction(paranaue, [
      candidate(clone(paranaue), 'same-id'),
    ]);
    expect(decision).toMatchObject({
      action: 'SKIP',
      status: SongImportStatus.UNCHANGED,
      songId: 'same-id',
    });
  });

  it('never overwrites a song edited since the import', () => {
    const edited = clone(paranaue);
    edited.parts[2].lines[0].translations[0].text =
      'Poprawione przez moderatora';
    edited.meaningTrivia = 'Nowa ciekawostka';

    const decision = decideImportAction(paranaue, [candidate(edited)]);

    expect(decision).toMatchObject({
      action: 'SKIP',
      status: SongImportStatus.SKIPPED_MODIFIED,
      songId: 'existing-id',
    });
    expect(decision.action === 'SKIP' && decision.differences).toEqual([
      expect.stringContaining('parts[2].lines[0].translations[0].text'),
      expect.stringContaining('meaningTrivia'),
    ]);
  });

  it('treats a same-titled song with different lyrics as an ambiguous collision', () => {
    const otherSong = clone(paranaue);
    otherSong.parts[0].lines[0].originalText = 'Completely different lyrics';

    const decision = decideImportAction(paranaue, [candidate(otherSong)]);

    expect(decision).toMatchObject({
      action: 'SKIP',
      status: SongImportStatus.SKIPPED_TITLE_COLLISION,
      songId: null,
    });
  });

  it('prefers an identical match over other same-titled candidates', () => {
    const otherSong = clone(paranaue);
    otherSong.parts[0].lines[0].originalText = 'Different';
    const decision = decideImportAction(paranaue, [
      candidate(otherSong, 'other'),
      candidate(clone(paranaue), 'identical'),
    ]);
    expect(decision).toMatchObject({
      status: SongImportStatus.UNCHANGED,
      songId: 'identical',
    });
  });
});

describe('song content snapshots', () => {
  it('report no differences for identical content', () => {
    const snapshot = snapshotFromRecord(recordTitled('Sou Jogador'));
    expect(diffSnapshots(snapshot, clone(snapshot))).toEqual([]);
  });

  it('detect a removed repeated line and a reordered part', () => {
    const expected = snapshotFromRecord(recordTitled('Sou Jogador'));

    const missingLine = clone(expected);
    missingLine.parts[0].lines.pop();
    expect(diffSnapshots(expected, missingLine)[0]).toContain(
      'parts[0].lines: expected',
    );

    const swapped = clone(expected);
    [swapped.parts[0], swapped.parts[1]] = [swapped.parts[1], swapped.parts[0]];
    expect(diffSnapshots(expected, swapped)).not.toEqual([]);
  });

  it('detect a truncated meaning text and a null vs empty mismatch', () => {
    const expected = snapshotFromRecord(recordTitled('Navio Negreiro'));
    const truncated = clone(expected);
    truncated.meaningHistory = expected.meaningHistory!.slice(0, -1);
    expect(diffSnapshots(expected, truncated)).toEqual([
      expect.stringContaining('meaningHistory'),
    ]);

    const authorChanged = clone(expected);
    authorChanged.authorName = null;
    expect(diffSnapshots(expected, authorChanged)).toEqual([
      expect.stringContaining('authorName'),
    ]);
  });

  it('detect a changed isUncertain flag even when the text is identical', () => {
    const expected = snapshotFromRecord(recordTitled('Paranauê'));
    const flipped = clone(expected);
    flipped.parts[16].lines[0].translations[0].isUncertain = false;
    expect(diffSnapshots(expected, flipped)).toEqual([
      expect.stringContaining('parts[16].lines[0].translations[0].isUncertain'),
    ]);
  });

  it('read a missing isUncertain in the file as false', () => {
    const record = clone(recordTitled('Navio Negreiro'));
    delete (
      record.parts[0].lines[0].translations[0] as { isUncertain?: boolean }
    ).isUncertain;
    expect(
      snapshotFromRecord(record).parts[0].lines[0].translations[0].isUncertain,
    ).toBe(false);
  });

  it('keep parts, lines and media in position order', () => {
    const record = clone(recordTitled('Adeus, Adeus (Boa Viagem)'));
    record.parts.reverse();
    record.media.reverse();
    const snapshot = snapshotFromRecord(record);
    expect(snapshot.parts.map((p) => p.position)).toEqual(
      [...Array(record.parts.length).keys()].map((i) => i + 1),
    );
    expect(snapshot.media.map((m) => m.position)).toEqual([1, 2, 3]);
  });
});

describe('countRecord', () => {
  it('counts parts, lines, Polish translations, media and alternative titles', () => {
    expect(countRecord(recordTitled('Paranauê'))).toEqual({
      parts: 24,
      lines: 36,
      translations: 36,
      media: 2,
      alternativeTitles: 2,
    });
  });

  it('adds up to the full dataset totals', () => {
    const totals = entries
      .map((entry) => countRecord(entry.record))
      .reduce((sum, counts) => ({
        parts: sum.parts + counts.parts,
        lines: sum.lines + counts.lines,
        translations: sum.translations + counts.translations,
        media: sum.media + counts.media,
        alternativeTitles: sum.alternativeTitles + counts.alternativeTitles,
      }));
    expect(totals).toEqual({
      parts: 719,
      lines: 1467,
      translations: 1467,
      media: 69,
      alternativeTitles: 110,
    });
  });
});
