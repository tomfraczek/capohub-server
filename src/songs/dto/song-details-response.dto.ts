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
}

export interface SongLineResponseDto {
  id: string;
  originalText: string;
  phoneticText: string | null;
  position: number;
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
  voteCount: number;
  isVotedByCurrentUser: boolean;
  createdBy: SongUserRefDto | null;
}

export interface SongDetailsResponseDto {
  id: string;
  title: string;
  authorName: string | null;
  status: SongStatus;
  category: SongCategoryResponseDto;
  createdBy: SongUserRefDto | null;
  alternativeTitles: SongAlternativeTitleResponseDto[];
  tags: TagResponseDto[];
  parts: SongPartResponseDto[];
  media: SongMediaResponseDto[];
  meaningHistory: string | null;
  meaningContext: string | null;
  meaningTrivia: string | null;
  createdAt: string;
  updatedAt: string;
}
