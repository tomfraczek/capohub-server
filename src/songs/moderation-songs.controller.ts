import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  ModerationQueueQueryDto,
  moderationQueueQuerySchema,
} from './dto/moderation-queue-query.schema';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import { SongSummaryResponseDto } from './dto/song-summary-response.dto';
import { SongsService } from './songs.service';

// Global moderation queue - a deliberately separate URL/controller from the
// public songbook (GET /songs) so that "what a moderator can see" and "what
// the public songbook shows" can never accidentally be conflated in one
// endpoint (see the moderation model audit). Thin on purpose: it adds no
// new persistence of its own, only a CONTENT_APPROVE-gated view over the
// exact same Song rows SongsService already manages - see
// SongsService.listModerationQueue/getDetails. Deciding a submission
// (publish/reject) still happens through the existing POST
// /songs/:id/publish|reject, not through this controller.
@Controller('moderation/songs')
@UseGuards(PermissionsGuard)
@Permissions(Permission.CONTENT_APPROVE)
export class ModerationSongsController {
  constructor(private readonly songsService: SongsService) {}

  // Defaults to PENDING_REVIEW (see moderationQueueQuerySchema) - "the
  // moderation queue" with no params on is exactly "what's waiting for a
  // decision right now", oldest submission first (see
  // queryModerationQueueIds). ?status=REJECTED surfaces recent decisions
  // instead.
  @Get()
  list(
    @Query(new ZodValidationPipe(moderationQueueQuerySchema))
    query: ModerationQueueQueryDto,
  ): Promise<PaginatedResponse<SongSummaryResponseDto>> {
    return this.songsService.listModerationQueue(query);
  }

  // Deliberately narrower than SongsService.getDetails (unrestricted) or
  // getPublicDetails (PUBLISHED-only) - getModerationDetails 404s unless
  // the Song is actually part of the new-song moderation workflow
  // (PENDING_REVIEW/REJECTED), even for a caller holding CONTENT_APPROVE.
  // A DRAFT/PUBLISHED/HIDDEN Song exists but isn't this endpoint's
  // concern - see SongsService.getModerationDetails's own comment.
  @Get(':id')
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<SongDetailsResponseDto> {
    return this.songsService.getModerationDetails(id, user.id);
  }
}
