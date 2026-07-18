import { User } from '../../users/entities/user.entity';
import { LearningStatus } from '../../song-library/enums/learning-status.enum';
import { SongPlaylistRefDto } from '../../playlists/dto/song-playlist-ref.dto';
import { SongRhythmRefDto } from '../../rhythms/dto/song-rhythm-ref.dto';
import {
  SongAlternativeTitleResponseDto,
  SongDetailsResponseDto,
  SongLineResponseDto,
  SongMediaResponseDto,
  SongPartResponseDto,
} from '../dto/song-details-response.dto';
import { SongMediaDetailsResponseDto } from '../dto/song-media-details-response.dto';
import { SongSummaryResponseDto } from '../dto/song-summary-response.dto';
import { SongUserRefDto } from '../dto/song-user-ref.dto';
import { SongMedia } from '../entities/song-media.entity';
import { Song } from '../entities/song.entity';
import { SongMediaVoteAggregates } from '../song-media-vote-aggregates';
import { toSongCategoryResponseDto } from './song-category.mapper';
import { toTagResponseDto } from './tag.mapper';

// Everything private to the current viewer (spec section 5/6) - always
// externally computed (see SongsService.getDetails), never queried here.
export interface SongUserContext {
  isFavorite: boolean;
  learningStatus: LearningStatus | null;
  myNote: string | null;
  playlists: SongPlaylistRefDto[];
}

type SongMediaBaseFields = Omit<
  SongMediaResponseDto,
  'voteCount' | 'isVotedByCurrentUser'
>;

// Shared by toSongDetailsResponseDto's nested `media` array and by
// toSongMediaDetailsResponseDto (verify/unverify endpoints), so the field
// list is only written once. Vote fields are added on top by each caller,
// since verify/unverify doesn't need them and toSongDetailsResponseDto
// needs externally-computed aggregates (see SongMediaVoteAggregates).
function mapSongMediaFields(media: SongMedia): SongMediaBaseFields {
  return {
    id: media.id,
    provider: media.provider,
    url: media.url,
    title: media.title,
    position: media.position,
    isVerified: media.isVerified,
    createdBy: toSongUserRefDto(media.createdBy),
  };
}

// clerkUserId, email and globalRole are deliberately never exposed here.
export function toSongUserRefDto(user: User | null): SongUserRefDto | null {
  if (!user) {
    return null;
  }

  return { id: user.id, displayName: user.displayName };
}

/**
 * Maps a fully-populated Song (category, createdBy, alternativeTitles, tags
 * + tag, parts + lines + translations, media + createdBy) to the response
 * shape for GET/POST/PATCH /songs/:id. Every child collection is already
 * ordered by `position` at the ORM level (see the entities' `orderBy`
 * options), so no sorting happens here.
 *
 * `voteAggregates` is externally computed (see loadSongMediaVoteAggregates)
 * - this function never queries anything itself.
 */
export function toSongDetailsResponseDto(
  song: Song,
  voteAggregates: SongMediaVoteAggregates,
  userContext: SongUserContext,
  rhythms: SongRhythmRefDto[],
): SongDetailsResponseDto {
  return {
    id: song.id,
    title: song.title,
    authorName: song.authorName,
    status: song.status,
    category: toSongCategoryResponseDto(song.category),
    createdBy: toSongUserRefDto(song.createdBy),
    alternativeTitles: song.alternativeTitles
      .getItems()
      .map((title): SongAlternativeTitleResponseDto => ({
        id: title.id,
        title: title.title,
        position: title.position,
      })),
    tags: song.tags.getItems().map((songTag) => toTagResponseDto(songTag.tag)),
    parts: song.parts.getItems().map((part): SongPartResponseDto => ({
      id: part.id,
      performer: part.performer,
      position: part.position,
      lines: part.lines.getItems().map((line): SongLineResponseDto => ({
        id: line.id,
        originalText: line.originalText,
        phoneticText: line.phoneticText,
        position: line.position,
        translations: line.translations.getItems().map((translation) => ({
          id: translation.id,
          languageCode: translation.languageCode,
          text: translation.text,
        })),
      })),
    })),
    media: song.media.getItems().map((media): SongMediaResponseDto => ({
      ...mapSongMediaFields(media),
      voteCount: voteAggregates.voteCountsByMediaId.get(media.id) ?? 0,
      isVotedByCurrentUser: voteAggregates.votedMediaId === media.id,
    })),
    meaningHistory: song.meaningHistory,
    meaningContext: song.meaningContext,
    meaningTrivia: song.meaningTrivia,
    rhythms,
    isFavorite: userContext.isFavorite,
    learningStatus: userContext.learningStatus,
    myNote: userContext.myNote,
    playlists: userContext.playlists,
    createdAt: song.createdAt.toISOString(),
    updatedAt: song.updatedAt.toISOString(),
  };
}

/**
 * Maps a single SongMedia row to the standalone response returned by the
 * verify/unverify endpoints. `media.song` only needs its id (the FK), which
 * MikroORM always has available without an explicit populate.
 */
export function toSongMediaDetailsResponseDto(
  media: SongMedia,
): SongMediaDetailsResponseDto {
  return {
    ...mapSongMediaFields(media),
    songId: media.song.id,
    createdAt: media.createdAt.toISOString(),
    updatedAt: media.updatedAt.toISOString(),
  };
}

export interface SongSummaryAggregates {
  hasPhonetics: boolean;
  translationLanguages: string[];
  hasMedia: boolean;
}

/**
 * Maps a Song (category, tags + tag, createdBy populated - parts/lines/media
 * deliberately NOT loaded) plus separately-computed aggregates to the list
 * row shape for GET /songs. See SongsService.list for how the aggregates are
 * computed without loading the full nested tree.
 */
export function toSongSummaryResponseDto(
  song: Song,
  aggregates: SongSummaryAggregates,
): SongSummaryResponseDto {
  return {
    id: song.id,
    title: song.title,
    authorName: song.authorName,
    status: song.status,
    category: toSongCategoryResponseDto(song.category),
    tags: song.tags.getItems().map((songTag) => toTagResponseDto(songTag.tag)),
    hasPhonetics: aggregates.hasPhonetics,
    translationLanguages: aggregates.translationLanguages,
    hasMedia: aggregates.hasMedia,
    createdBy: toSongUserRefDto(song.createdBy),
    createdAt: song.createdAt.toISOString(),
    updatedAt: song.updatedAt.toISOString(),
  };
}
