import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AllowGroupStatuses } from '../groups/decorators/allow-group-statuses.decorator';
import {
  RequireGroupKind,
  GroupKind,
} from '../groups/decorators/require-group-kind.decorator';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { User } from '../users/entities/user.entity';
import { CreateRankDto, createRankSchema } from './dto/create-rank.schema';
import {
  RankResponseDto,
  RanksByTrackResponseDto,
} from './dto/rank-response.dto';
import { UpdateRankDto, updateRankSchema } from './dto/update-rank.schema';
import { RanksService } from './ranks.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Same "root Group only, never Section" mounting as
// GraduationSystemController - see that controller's own comment.
@Controller('groups/:groupId/ranks')
@UseGuards(GroupPermissionsGuard)
export class RanksController {
  constructor(private readonly ranksService: RanksService) {}

  @Get()
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  list(@Param('groupId') groupId: string): Promise<RanksByTrackResponseDto> {
    return this.ranksService.list(groupId);
  }

  @Get(':rankId')
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('groupId') groupId: string,
    @Param('rankId', ParseUUIDPipe) rankId: string,
  ): Promise<RankResponseDto> {
    return this.ranksService.getById(groupId, rankId);
  }

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  create(
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(createRankSchema)) dto: CreateRankDto,
    @CurrentUser() user: User,
  ): Promise<RankResponseDto> {
    return this.ranksService.create(groupId, dto, user);
  }

  @Patch(':rankId')
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  update(
    @Param('groupId') groupId: string,
    @Param('rankId', ParseUUIDPipe) rankId: string,
    @Body(new ZodValidationPipe(updateRankSchema)) dto: UpdateRankDto,
    @CurrentUser() user: User,
  ): Promise<RankResponseDto> {
    return this.ranksService.update(groupId, rankId, dto, user);
  }

  @Post(':rankId/archive')
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  archive(
    @Param('groupId') groupId: string,
    @Param('rankId', ParseUUIDPipe) rankId: string,
    @CurrentUser() user: User,
  ): Promise<RankResponseDto> {
    return this.ranksService.archive(groupId, rankId, user);
  }

  @Post(':rankId/restore')
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  restore(
    @Param('groupId') groupId: string,
    @Param('rankId', ParseUUIDPipe) rankId: string,
    @CurrentUser() user: User,
  ): Promise<RankResponseDto> {
    return this.ranksService.restore(groupId, rankId, user);
  }
}
