import { Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DuplicateSongSuggestionDto } from './dto/duplicate-suggestion-response.dto';
import {
  DuplicateCandidateRow,
  queryDuplicateCandidates,
} from './duplicate-suggestions.query';
import { Song } from './entities/song.entity';
import {
  compareSuggestionCandidates,
  computeOptionalTextSimilarity,
  computeSimilarity,
  isLikelyDuplicateMatch,
  SUGGESTION_MIN_SIMILARITY,
} from './song-duplicate.utils';

// Below this, the title is too short to search meaningfully - the frontend
// is still typing, so we return an empty list rather than noisy matches
// (spec section 2).
const MIN_TITLE_LENGTH_FOR_SUGGESTIONS = 3;

const MAX_BLOCKING_RESULTS = 3;

interface ScoredCandidate extends DuplicateCandidateRow {
  titleSimilarity: number;
}

/**
 * Single source of truth for "is this song a likely duplicate of an
 * existing one" - backs both GET /songs/duplicate-suggestions (advisory,
 * low threshold) and the POST /songs/:id/submit blocking check (strict
 * threshold). Both entry points call scoreCandidates(), so the candidate
 * query and the similarity algorithm are never duplicated between them.
 */
@Injectable()
export class SongDuplicateService {
  async findSuggestions(
    em: EntityManager,
    currentUserId: string,
    rawTitle: string,
    limit: number,
  ): Promise<DuplicateSongSuggestionDto[]> {
    const trimmedTitle = rawTitle.trim();
    if (trimmedTitle.length < MIN_TITLE_LENGTH_FOR_SUGGESTIONS) {
      return [];
    }

    const scored = await this.scoreCandidates(em, currentUserId, trimmedTitle);

    return scored
      .filter(
        (candidate) => candidate.titleSimilarity >= SUGGESTION_MIN_SIMILARITY,
      )
      .sort((a, b) => compareSuggestionCandidates(toRankable(a), toRankable(b)))
      .slice(0, limit)
      .map((candidate) =>
        toSuggestionDto(candidate, candidate.titleSimilarity),
      );
  }

  /**
   * Submit-time duplicate check (spec sections 11/12). `currentSong` must
   * already have `parts.lines` populated (submit() loads it that way
   * anyway for assertReadyForReview) - its first line is read in memory,
   * no extra query. Returns up to 3 candidates that meet the strict
   * blocking bar; an empty array means submit may proceed.
   */
  async findBlockingDuplicates(
    em: EntityManager,
    currentUserId: string,
    currentSong: Song,
  ): Promise<DuplicateSongSuggestionDto[]> {
    const currentFirstLine = pickFirstNonEmptyLine(currentSong);
    const scored = await this.scoreCandidates(
      em,
      currentUserId,
      currentSong.title,
      currentSong.id,
    );

    const blocking = scored
      .map((candidate) => ({
        ...candidate,
        firstLineSimilarity: computeOptionalTextSimilarity(
          currentFirstLine,
          candidate.firstLine,
        ),
      }))
      .filter((candidate) =>
        isLikelyDuplicateMatch({
          titleSimilarity: candidate.titleSimilarity,
          firstLineSimilarity: candidate.firstLineSimilarity,
        }),
      )
      .sort((a, b) => compareSuggestionCandidates(toRankable(a), toRankable(b)))
      .slice(0, MAX_BLOCKING_RESULTS);

    return blocking.map((candidate) =>
      toSuggestionDto(candidate, candidate.titleSimilarity),
    );
  }

  private async scoreCandidates(
    em: EntityManager,
    currentUserId: string,
    title: string,
    excludeSongId?: string,
  ): Promise<ScoredCandidate[]> {
    const candidates = await queryDuplicateCandidates(em, {
      currentUserId,
      searchTerm: title,
      excludeSongId,
    });

    return candidates.map((candidate) => ({
      ...candidate,
      titleSimilarity: computeSimilarity(title, candidate.title),
    }));
  }
}

function toRankable(candidate: ScoredCandidate): {
  title: string;
  status: ScoredCandidate['status'];
  similarity: number;
} {
  return {
    title: candidate.title,
    status: candidate.status,
    similarity: candidate.titleSimilarity,
  };
}

function toSuggestionDto(
  candidate: DuplicateCandidateRow,
  similarity: number,
): DuplicateSongSuggestionDto {
  return {
    id: candidate.id,
    title: candidate.title,
    firstLine: candidate.firstLine,
    status: candidate.status,
    similarity,
  };
}

// Song.parts and each part's .lines are both populated with `orderBy:
// { position: 'ASC' }` on the entity (see song.entity.ts / song-part.entity.ts),
// so a simple in-order scan is enough - no re-sorting needed here.
function pickFirstNonEmptyLine(song: Song): string | null {
  for (const part of song.parts.getItems()) {
    for (const line of part.lines.getItems()) {
      if (line.originalText.trim().length > 0) {
        return line.originalText;
      }
    }
  }
  return null;
}
