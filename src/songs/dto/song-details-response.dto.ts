import { LearningStatus } from '../../song-library/enums/learning-status.enum';
import { SongPlaylistRefDto } from '../../playlists/dto/song-playlist-ref.dto';
import { SongRhythmRefDto } from '../../rhythms/dto/song-rhythm-ref.dto';
import { SongMediaProvider } from '../enums/song-media-provider.enum';
import { SongPerformer } from '../enums/song-performer.enum';
import { SongStatus } from '../enums/song-status.enum';
import { SongCategoryResponseDto } from './song-category-response.dto';
import { TagResponseDto } from './tag-response.dto';
import { SongUserRefDto } from './song-user-ref.dto';

export interface SongLineTranslationResponseDto {
  id: string;
  languageCode: string;
  text: string;
  isUncertain: boolean;
}

// One phonetic transcription per language (mirrors
// SongLineTranslationResponseDto exactly) - never a single flat
// phoneticText, since the same Portuguese line reads differently depending
// on the reader's own language.
export interface SongLinePhoneticResponseDto {
  id: string;
  languageCode: string;
  text: string;
}

export interface SongLineResponseDto {
  id: string;
  originalText: string;
  position: number;
  phonetics: SongLinePhoneticResponseDto[];
  translations: SongLineTranslationResponseDto[];
}

export interface SongPartResponseDto {
  id: string;
  performer: SongPerformer;
  position: number;
  lines: SongLineResponseDto[];
}

export interface SongAlternativeTitleResponseDto {
  id: string;
  title: string;
  position: number;
}

export interface SongMediaResponseDto {
  id: string;
  provider: SongMediaProvider;
  url: string;
  title: string | null;
  position: number;
  isVerified: boolean;
  createdBy: SongUserRefDto | null;
}

export interface SongDetailsResponseDto {
  id: string;
  title: string;
  authorName: string | null;
  status: SongStatus;
  // Set only while status === REJECTED (see SongsService.reject); cleared
  // on the next successful submit. Never set/read for a SongEditProposal's
  // own rejection - see SongEditProposalResponseDto.rejectionReason.
  rejectionReason: string | null;
  category: SongCategoryResponseDto;
  createdBy: SongUserRefDto | null;
  alternativeTitles: SongAlternativeTitleResponseDto[];
  tags: TagResponseDto[];
  parts: SongPartResponseDto[];
  media: SongMediaResponseDto[];
  meaningHistory: string | null;
  meaningContext: string | null;
  meaningTrivia: string | null;
  // Global reference data (Muzyka > Rytmy), not private to the viewer -
  // unlike isFavorite/learningStatus/myNote/playlists below, this is the
  // same for every caller who can see the song at all. Only active rhythms
  // are included (see loadRhythmsForSong).
  rhythms: SongRhythmRefDto[];
  // Every field below is private to the current viewer (spec section 6) -
  // never another user's favorite/status/note/playlists. All default to
  // "empty" (false/null/[]) when there is no current user, e.g. internal
  // calls from submit/publish/reject/hide/restore - see SongsService.getDetails.
  isFavorite: boolean;
  learningStatus: LearningStatus | null;
  myNote: string | null;
  playlists: SongPlaylistRefDto[];
  createdAt: string;
  updatedAt: string;
}
