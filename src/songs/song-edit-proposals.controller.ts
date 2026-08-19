import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../auth/permissions/permission.enum';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  CreateSongEditProposalDto,
  createSongEditProposalSchema,
} from './dto/create-song-edit-proposal.schema';
import {
  ModerationReasonDto,
  moderationReasonSchema,
} from './dto/moderation-reason.schema';
import { SongEditProposalResponseDto } from './dto/song-edit-proposal-response.dto';
import { SongEditProposalsService } from './song-edit-proposals.service';

// Edit workflow for a protected (PUBLISHED/HIDDEN) Song - see
// SongEditProposalsService's own comment and the moderation model. Always
// scoped under a specific Song (never a cross-song moderation queue - that
// is deliberately out of scope for now, see the moderation implementation
// report; a moderator reviewing one song's page already reaches this).
@Controller('songs/:songId/edit-proposals')
export class SongEditProposalsController {
  constructor(
    private readonly songEditProposalsService: SongEditProposalsService,
  ) {}

  // No declarative permission here - any authenticated user may propose a
  // change to *any* published/hidden song, not just their own. Ownership
  // (createdBy) grants nothing once a Song is protected content, and
  // proposing a change mutates nothing by itself (see
  // SongEditProposalsService.create's own comment) - only approve(), gated
  // by CONTENT_APPROVE below, actually touches the Song.
  @Post()
  @HttpCode(201)
  create(
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSongEditProposalSchema))
    dto: CreateSongEditProposalDto,
  ): Promise<SongEditProposalResponseDto> {
    return this.songEditProposalsService.create(songId, user, dto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions(Permission.CONTENT_APPROVE)
  list(
    @Param('songId', ParseUUIDPipe) songId: string,
  ): Promise<SongEditProposalResponseDto[]> {
    return this.songEditProposalsService.list(songId);
  }

  @Get(':proposalId')
  @UseGuards(PermissionsGuard)
  @Permissions(Permission.CONTENT_APPROVE)
  getById(
    @Param('songId', ParseUUIDPipe) songId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ): Promise<SongEditProposalResponseDto> {
    return this.songEditProposalsService.getById(songId, proposalId);
  }

  @Post(':proposalId/approve')
  @UseGuards(PermissionsGuard)
  @Permissions(Permission.CONTENT_APPROVE)
  approve(
    @Param('songId', ParseUUIDPipe) songId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: User,
  ): Promise<SongEditProposalResponseDto> {
    return this.songEditProposalsService.approve(songId, proposalId, user);
  }

  @Post(':proposalId/reject')
  @UseGuards(PermissionsGuard)
  @Permissions(Permission.CONTENT_APPROVE)
  reject(
    @Param('songId', ParseUUIDPipe) songId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(moderationReasonSchema))
    dto: ModerationReasonDto,
  ): Promise<SongEditProposalResponseDto> {
    return this.songEditProposalsService.reject(songId, proposalId, user, dto);
  }
}
