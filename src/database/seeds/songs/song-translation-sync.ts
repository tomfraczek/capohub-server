import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SongEditProposal } from '../../../songs/entities/song-edit-proposal.entity';
import { SongLine } from '../../../songs/entities/song-line.entity';
import { SongLineTranslation } from '../../../songs/entities/song-line-translation.entity';
import { Song } from '../../../songs/entities/song.entity';
import { SongEditProposalStatus } from '../../../songs/enums/song-edit-proposal-status.enum';
import { normalizeSongDuplicateText } from '../../../songs/song-duplicate.utils';
import {
  candidateIdsFor,
  ExistingSongCandidate,
  loadCandidates,
  loadExistingNameIndex,
} from './song-import';
import { SongImportEntry, SongImportRecord } from './song-import.schema';
import {
  diffSnapshots,
  normalizedFirstLine,
  snapshotFromRecord,
  SongContentSnapshot,
} from './song-import.snapshot';

export enum SongTranslationSyncStatus {
  UPDATED = 'UPDATED',
  WOULD_UPDATE = 'WOULD_UPDATE',
  // The song already matches the file exactly.
  UNCHANGED = 'UNCHANGED',
  // No song with this title + first line - create it with seed:songs.
  NOT_FOUND = 'NOT_FOUND',
  // More than one song with this title + first line.
  CONFLICT_AMBIGUOUS = 'CONFLICT_AMBIGUOUS',
  // Something other than translations/meaning texts differs (lyrics,
  // parts, media, titles, ...) - the song was changed in the app.
  CONFLICT_STRUCTURE = 'CONFLICT_STRUCTURE',
  // A pending or approved edit proposal exists: the translations may be a
  // user's (or about to be overwritten by one), so they are not touched.
  CONFLICT_EDIT_PROPOSALS = 'CONFLICT_EDIT_PROPOSALS',
  FAILED = 'FAILED',
}

export interface SongTranslationSyncResult {
  source: string;
  title: string;
  status: SongTranslationSyncStatus;
  songId: string | null;
  detail: string | null;
  // Human-readable list of what was (or would be) changed.
  changes: string[];
}

export interface SongTranslationSyncOptions {
  dryRun?: boolean;
}

const MEANING_FIELDS = [
  'meaningHistory',
  'meaningContext',
  'meaningTrivia',
] as const;

const BLOCKING_PROPOSAL_STATUSES = [
  SongEditProposalStatus.PENDING,
  SongEditProposalStatus.APPROVED,
];

/**
 * Everything the sync must leave exactly as it is - the snapshot without
 * translations and meaning texts. Two songs with equal "frames" differ
 * only in what the sync is allowed to write.
 */
export function syncFrame(snapshot: SongContentSnapshot): SongContentSnapshot {
  return {
    ...snapshot,
    parts: snapshot.parts.map((part) => ({
      ...part,
      lines: part.lines.map((line) => ({ ...line, translations: [] })),
    })),
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
  };
}

interface StoredLine {
  lineId: string;
  translations: Map<
    string,
    { id: string; text: string; isUncertain: boolean } | undefined
  >;
}

type PlannedChange =
  | {
      kind: 'UPDATE_TRANSLATION';
      translationId: string;
      text: string;
      isUncertain: boolean;
      label: string;
    }
  | {
      kind: 'INSERT_TRANSLATION';
      lineId: string;
      languageCode: string;
      text: string;
      isUncertain: boolean;
      label: string;
    }
  | {
      kind: 'UPDATE_MEANING';
      field: (typeof MEANING_FIELDS)[number];
      value: string | null;
      label: string;
    };

/**
 * Brings the translations (text + isUncertain) and the three meaning texts
 * of already-imported songs in line with the corrected source files - the
 * counterpart of importSongs(), which never touches an existing song.
 *
 * Safe by construction:
 *  - only songs whose everything-else (lyrics, parts, titles, media,
 *    category, tags, rhythms) still equals the file are touched;
 *  - a song with a pending or approved edit proposal is skipped, since its
 *    translations may be a user's work (or would be reverted on approval);
 *  - translations are updated in place (ids kept); only a missing
 *    translation in one of the file's languages is ever inserted, and
 *    other languages are never touched or deleted;
 *  - each song is one transaction, holding a row lock on the song while
 *    the checks are repeated against the locked state;
 *  - re-running it changes nothing (UNCHANGED).
 */
export async function syncSongTranslations(
  em: EntityManager,
  entries: SongImportEntry[],
  options: SongTranslationSyncOptions = {},
): Promise<SongTranslationSyncResult[]> {
  const nameIndex = await loadExistingNameIndex(em);
  const results: SongTranslationSyncResult[] = [];

  for (const entry of entries) {
    const base = { source: entry.source, title: entry.record.title };
    const expected = snapshotFromRecord(entry.record);
    const candidates = await loadCandidates(
      em.fork(),
      candidateIdsFor(nameIndex, entry.record),
    );
    const target = pickTarget(expected, candidates);

    if (target.status) {
      results.push({ ...base, changes: [], ...target.status });
      continue;
    }

    const songId = target.songId;
    try {
      const outcome = options.dryRun
        ? await planSync(em.fork(), songId, entry.record, expected)
        : await em.fork().transactional(async (tem) => {
            await tem.findOneOrFail(
              Song,
              { id: songId },
              { lockMode: LockMode.PESSIMISTIC_WRITE },
            );
            const plan = await planSync(tem, songId, entry.record, expected);
            if (plan.status === SongTranslationSyncStatus.UPDATED) {
              await applyPlan(tem, songId, plan.changes);
            }
            return plan;
          });

      results.push({
        ...base,
        songId,
        status:
          options.dryRun && outcome.status === SongTranslationSyncStatus.UPDATED
            ? SongTranslationSyncStatus.WOULD_UPDATE
            : outcome.status,
        detail: outcome.detail,
        changes: outcome.changes.map((change) => change.label),
      });
    } catch (error) {
      results.push({
        ...base,
        songId,
        status: SongTranslationSyncStatus.FAILED,
        detail: error instanceof Error ? error.message : String(error),
        changes: [],
      });
    }
  }

  return results;
}

function pickTarget(
  expected: SongContentSnapshot,
  candidates: ExistingSongCandidate[],
):
  | { status: null; songId: string }
  | {
      status: Pick<SongTranslationSyncResult, 'status' | 'songId' | 'detail'>;
    } {
  const identical = candidates.find(
    (c) => diffSnapshots(expected, c.snapshot).length === 0,
  );
  if (identical) {
    return {
      status: {
        status: SongTranslationSyncStatus.UNCHANGED,
        songId: identical.songId,
        detail: null,
      },
    };
  }

  const title = normalizeSongDuplicateText(expected.title);
  const firstLine = normalizedFirstLine(expected);
  const sameSong = candidates.filter(
    (c) =>
      normalizeSongDuplicateText(c.snapshot.title) === title &&
      normalizedFirstLine(c.snapshot) === firstLine,
  );

  if (sameSong.length === 0) {
    return {
      status: {
        status: SongTranslationSyncStatus.NOT_FOUND,
        songId: null,
        detail: 'no song with this title and first line - run seed:songs',
      },
    };
  }
  if (sameSong.length > 1) {
    return {
      status: {
        status: SongTranslationSyncStatus.CONFLICT_AMBIGUOUS,
        songId: null,
        detail: `matches ${sameSong.map((c) => c.songId).join(', ')}`,
      },
    };
  }
  return { status: null, songId: sameSong[0].songId };
}

async function planSync(
  em: EntityManager,
  songId: string,
  record: SongImportRecord,
  expected: SongContentSnapshot,
): Promise<{
  status: SongTranslationSyncStatus;
  detail: string | null;
  changes: PlannedChange[];
}> {
  const blockingProposals = await em.count(SongEditProposal, {
    song: songId,
    status: { $in: BLOCKING_PROPOSAL_STATUSES },
  });
  if (blockingProposals > 0) {
    return {
      status: SongTranslationSyncStatus.CONFLICT_EDIT_PROPOSALS,
      detail: `${blockingProposals} pending/approved edit proposal(s) - translations may have been edited by users`,
      changes: [],
    };
  }

  const [current] = await loadCandidates(em, [songId]);
  const frameDifferences = diffSnapshots(
    syncFrame(expected),
    syncFrame(current.snapshot),
  );
  if (frameDifferences.length > 0) {
    return {
      status: SongTranslationSyncStatus.CONFLICT_STRUCTURE,
      detail: `content other than translations differs: ${frameDifferences.join('; ')}`,
      changes: [],
    };
  }

  const storedLines = await loadStoredLines(em, songId);
  const changes: PlannedChange[] = [];

  for (const part of record.parts) {
    for (const line of part.lines) {
      const stored = storedLines.get(`${part.position}:${line.position}`)!;
      for (const translation of line.translations) {
        const isUncertain = translation.isUncertain ?? false;
        const existing = stored.translations.get(translation.languageCode);
        const label = `part ${part.position} line ${line.position} [${translation.languageCode}]`;

        if (!existing) {
          changes.push({
            kind: 'INSERT_TRANSLATION',
            lineId: stored.lineId,
            languageCode: translation.languageCode,
            text: translation.text,
            isUncertain,
            label: `${label}: insert "${translation.text}" (isUncertain=${isUncertain})`,
          });
        } else if (
          existing.text !== translation.text ||
          existing.isUncertain !== isUncertain
        ) {
          changes.push({
            kind: 'UPDATE_TRANSLATION',
            translationId: existing.id,
            text: translation.text,
            isUncertain,
            label: `${label}: "${existing.text}" -> "${translation.text}" (isUncertain ${existing.isUncertain} -> ${isUncertain})`,
          });
        }
      }
    }
  }

  for (const field of MEANING_FIELDS) {
    if (current.snapshot[field] !== record[field]) {
      changes.push({
        kind: 'UPDATE_MEANING',
        field,
        value: record[field],
        label: `${field} updated`,
      });
    }
  }

  return {
    status:
      changes.length > 0
        ? SongTranslationSyncStatus.UPDATED
        : SongTranslationSyncStatus.UNCHANGED,
    detail: null,
    changes,
  };
}

async function loadStoredLines(
  em: EntityManager,
  songId: string,
): Promise<Map<string, StoredLine>> {
  const rows = await em.getConnection().execute<
    {
      lineId: string;
      partPosition: number;
      linePosition: number;
      translationId: string | null;
      languageCode: string | null;
      text: string | null;
      isUncertain: boolean | null;
    }[]
  >(
    `select sl.id as "lineId", sp.position as "partPosition", sl.position as "linePosition",
            slt.id as "translationId", slt.language_code as "languageCode",
            slt.text, slt.is_uncertain as "isUncertain"
     from song_lines sl
     inner join song_parts sp on sp.id = sl.part_id
     left join song_line_translations slt on slt.line_id = sl.id
     where sp.song_id = ?`,
    [songId],
    'all',
    em.getTransactionContext(),
  );

  const lines = new Map<string, StoredLine>();
  for (const row of rows) {
    const key = `${row.partPosition}:${row.linePosition}`;
    const line = lines.get(key) ?? {
      lineId: row.lineId,
      translations: new Map(),
    };
    if (row.translationId && row.languageCode) {
      line.translations.set(row.languageCode, {
        id: row.translationId,
        text: row.text!,
        isUncertain: row.isUncertain!,
      });
    }
    lines.set(key, line);
  }
  return lines;
}

async function applyPlan(
  em: EntityManager,
  songId: string,
  changes: PlannedChange[],
): Promise<void> {
  const now = new Date();
  const song = await em.findOneOrFail(Song, { id: songId });

  for (const change of changes) {
    switch (change.kind) {
      case 'UPDATE_TRANSLATION':
        await em.nativeUpdate(
          SongLineTranslation,
          { id: change.translationId },
          {
            text: change.text,
            isUncertain: change.isUncertain,
            updatedAt: now,
          },
        );
        break;
      case 'INSERT_TRANSLATION': {
        const translation = new SongLineTranslation();
        translation.line = em.getReference(SongLine, change.lineId);
        translation.languageCode = change.languageCode;
        translation.text = change.text;
        translation.isUncertain = change.isUncertain;
        em.persist(translation);
        break;
      }
      case 'UPDATE_MEANING':
        song[change.field] = change.value;
        break;
    }
  }

  // Every change - including a translation-only one - is a content change
  // of the song, so its updatedAt moves too.
  song.updatedAt = now;
  await em.flush();
}
