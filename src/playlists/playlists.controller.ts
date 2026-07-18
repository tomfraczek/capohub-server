import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  AddPlaylistSongDto,
  addPlaylistSongSchema,
} from './dto/add-playlist-song.schema';
import {
  CreatePlaylistDto,
  createPlaylistSchema,
} from './dto/create-playlist.schema';
import { PlaylistResponseDto } from './dto/playlist-response.dto';
import { PlaylistSummaryResponseDto } from './dto/playlist-summary-response.dto';
import {
  ReorderPlaylistSongsDto,
  reorderPlaylistSongsSchema,
} from './dto/reorder-playlist-songs.schema';
import {
  UpdatePlaylistDto,
  updatePlaylistSchema,
} from './dto/update-playlist.schema';
import { PlaylistsService } from './playlists.service';

// Every route here is implicitly scoped to @CurrentUser() - playlists are
// private-only (spec section 4/6), so there is no separate "public
// playlists" browsing surface yet, and no id-only lookup that skips the
// ownership check.
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<PlaylistSummaryResponseDto[]> {
    return this.playlistsService.list(user.id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createPlaylistSchema)) dto: CreatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    return this.playlistsService.create(user, dto);
  }

  @Get(':id')
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<PlaylistResponseDto> {
    return this.playlistsService.getById(user.id, id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updatePlaylistSchema)) dto: UpdatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    return this.playlistsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.playlistsService.delete(user.id, id);
  }

  @Post(':id/songs')
  addSong(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(addPlaylistSongSchema))
    dto: AddPlaylistSongDto,
  ): Promise<PlaylistResponseDto> {
    return this.playlistsService.addSong(user.id, id, dto.songId);
  }

  @Delete(':id/songs/:songId')
  removeSong(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
  ): Promise<PlaylistResponseDto> {
    return this.playlistsService.removeSong(user.id, id, songId);
  }

  @Patch(':id/songs/order')
  reorderSongs(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(reorderPlaylistSongsSchema))
    dto: ReorderPlaylistSongsDto,
  ): Promise<PlaylistResponseDto> {
    return this.playlistsService.reorderSongs(user.id, id, dto.songIds);
  }
}
