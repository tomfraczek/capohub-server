import { User } from '../../users/entities/user.entity';
import {
  SongAlternativeTitleResponseDto,
  SongDetailsResponseDto,
  SongLineResponseDto,
  SongMediaResponseDto,
  SongPartResponseDto,
} from '../dto/song-details-response.dto';
import { SongSummaryResponseDto } from '../dto/song-summary-response.dto';
import { SongUserRefDto } from '../dto/song-user-ref.dto';
import { Song } from '../entities/song.entity';
import { toSongCategoryResponseDto } from './song-category.mapper';
import { toTagResponseDto } from './tag.mapper';

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
 */
export function toSongDetailsResponseDto(song: Song): SongDetailsResponseDto {
  return {
    id: song.id,
    title: song.title,
    slug: song.slug,
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
      id: media.id,
      provider: media.provider,
      url: media.url,
      title: media.title,
      position: media.position,
      isVerified: media.isVerified,
      createdBy: toSongUserRefDto(media.createdBy),
    })),
    meaningHistory: song.meaningHistory,
    meaningContext: song.meaningContext,
    meaningTrivia: song.meaningTrivia,
    createdAt: song.createdAt.toISOString(),
    updatedAt: song.updatedAt.toISOString(),
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
    slug: song.slug,
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
