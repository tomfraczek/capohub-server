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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../auth/permissions/permission.enum';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CreateSongDto, createSongSchema } from './dto/create-song.schema';
import { DuplicateSuggestionsResponseDto } from './dto/duplicate-suggestion-response.dto';
import {
  DuplicateSuggestionsQueryDto,
  duplicateSuggestionsQuerySchema,
} from './dto/duplicate-suggestions-query.schema';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import {
  ListSongsQueryDto,
  listSongsQuerySchema,
} from './dto/song-list-query.schema';
import { SongMediaDetailsResponseDto } from './dto/song-media-details-response.dto';
import { SongMediaVoteResponseDto } from './dto/song-media-vote-response.dto';
import { SongSummaryResponseDto } from './dto/song-summary-response.dto';
import { UpdateSongDto, updateSongSchema } from './dto/update-song.schema';
import { SongsService } from './songs.service';

@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSongSchema)) dto: CreateSongDto,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.create(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(listSongsQuerySchema))
    query: ListSongsQueryDto,
  ): Promise<PaginatedResponse<SongSummaryResponseDto>> {
    return this.songsService.list(user, query);
  }

  // Must stay registered before GET /:id - otherwise "duplicate-suggestions"
  // would be swallowed by the :id param route (and rejected by
  // ParseUUIDPipe, since it isn't a UUID).
  @Get('duplicate-suggestions')
  getDuplicateSuggestions(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(duplicateSuggestionsQuerySchema))
    query: DuplicateSuggestionsQueryDto,
  ): Promise<DuplicateSuggestionsResponseDto> {
    return this.songsService.getDuplicateSuggestions(
      user,
      query.title,
      query.limit,
    );
  }

  @Get(':id')
  getDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.getDetails(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateSongSchema)) dto: UpdateSongDto,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.songsService.delete(id);
  }

  @Post(':id/submit')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.submit(id, user);
  }

  @Post(':id/publish')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.publish(id);
  }

  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.reject(id);
  }

  @Post(':id/hide')
  hide(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.hide(id);
  }

  @Post(':id/restore')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.restore(id);
  }

  @Post(':songId/media/:mediaId/verify')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @Permissions(Permission.CONTENT_APPROVE)
  verifyMedia(
    @Param('songId', ParseUUIDPipe) songId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<SongMediaDetailsResponseDto> {
    return this.songsService.verifyMedia(songId, mediaId);
  }

  @Post(':songId/media/:mediaId/unverify')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @Permissions(Permission.CONTENT_APPROVE)
  unverifyMedia(
    @Param('songId', ParseUUIDPipe) songId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<SongMediaDetailsResponseDto> {
    return this.songsService.unverifyMedia(songId, mediaId);
  }

  // No body, no ZodValidationPipe - the whole request is just the two path
  // params + the caller's identity. Any authenticated user may vote,
  // regardless of globalRole - no PermissionsGuard here (unlike verify/
  // unverify above).
  @Put(':songId/media/:mediaId/vote')
  setMediaVote(
    @Param('songId', ParseUUIDPipe) songId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentUser() user: User,
  ): Promise<SongMediaVoteResponseDto> {
    return this.songsService.setMediaVote(songId, mediaId, user);
  }

  @Delete(':songId/vote')
  @HttpCode(204)
  removeMediaVote(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.songsService.removeMediaVote(songId, user);
  }
}
