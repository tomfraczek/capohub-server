import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { FavoriteSongResponseDto } from './dto/favorite-song-response.dto';
import { LearningStatusResponseDto } from './dto/learning-status-response.dto';
import {
  SetLearningStatusDto,
  setLearningStatusSchema,
} from './dto/set-learning-status.schema';
import { SetSongNoteDto, setSongNoteSchema } from './dto/set-song-note.schema';
import { SongNoteResponseDto } from './dto/song-note-response.dto';
import { FavoriteSongsService } from './favorite-songs.service';
import { LearningStatusService } from './learning-status.service';
import { SongNotesService } from './song-notes.service';

// Groups every song-scoped, single-user-row personal reaction to a Song
// (favorite / learning status / note) behind one songs/:songId prefix - the
// business logic for each still lives in its own dedicated service. The
// list endpoints (GET /users/me/favorite-songs, /learning-songs) live on
// UsersController instead, since they're not song-scoped.
@Controller('songs/:songId')
export class SongInteractionsController {
  constructor(
    private readonly favoriteSongsService: FavoriteSongsService,
    private readonly learningStatusService: LearningStatusService,
    private readonly songNotesService: SongNotesService,
  ) {}

  @Post('favorite')
  async addFavorite(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
  ): Promise<FavoriteSongResponseDto> {
    await this.favoriteSongsService.addFavorite(user, songId);
    return { songId, isFavorite: true };
  }

  @Delete('favorite')
  @HttpCode(204)
  async removeFavorite(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.favoriteSongsService.removeFavorite(user.id, songId);
  }

  @Put('learning-status')
  async setLearningStatus(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(setLearningStatusSchema))
    dto: SetLearningStatusDto,
  ): Promise<LearningStatusResponseDto> {
    const status = await this.learningStatusService.setStatus(
      user,
      songId,
      dto.status,
    );
    return { songId, status };
  }

  @Delete('learning-status')
  @HttpCode(204)
  async removeLearningStatus(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.learningStatusService.removeStatus(user.id, songId);
  }

  @Get('my-note')
  async getMyNote(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
  ): Promise<SongNoteResponseDto> {
    const note = await this.songNotesService.getNote(user.id, songId);
    return {
      songId,
      content: note?.content ?? null,
      updatedAt: note ? note.updatedAt.toISOString() : null,
    };
  }

  @Put('my-note')
  async setMyNote(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(setSongNoteSchema)) dto: SetSongNoteDto,
  ): Promise<SongNoteResponseDto> {
    const note = await this.songNotesService.upsertNote(
      user,
      songId,
      dto.content,
    );
    return {
      songId,
      content: note.content,
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  @Delete('my-note')
  @HttpCode(204)
  async removeMyNote(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.songNotesService.removeNote(user.id, songId);
  }
}
