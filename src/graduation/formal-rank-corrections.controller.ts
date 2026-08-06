import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginatedResponse } from '../common/pagination/pagination.types';
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
import {
  CreateFormalRankCorrectionDto,
  createFormalRankCorrectionSchema,
} from './dto/create-formal-rank-correction.schema';
import {
  FormalRankCorrectionQueryDto,
  formalRankCorrectionQuerySchema,
} from './dto/formal-rank-correction-query.schema';
import { FormalRankCorrectionResponseDto } from './dto/formal-rank-correction-response.dto';
import {
  RejectFormalRankCorrectionDto,
  rejectFormalRankCorrectionSchema,
} from './dto/reject-formal-rank-correction.schema';
import { FormalRankCorrectionService } from './formal-rank-correction.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// The formal rank correction workflow always belongs to the exact Section
// a target member belongs to - never a root Group, never inherited (see
// the module spec) - so this is single-mounted with
// @RequireGroupKind(SECTION), same as SectionController's own routes: a
// Group id 404s here rather than being silently served.
@Controller('sections/:sectionId/formal-rank-corrections')
@UseGuards(GroupPermissionsGuard)
export class FormalRankCorrectionsController {
  constructor(
    private readonly formalRankCorrectionService: FormalRankCorrectionService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_CORRECTION_REQUEST)
  @RequireGroupKind(GroupKind.SECTION)
  request(
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createFormalRankCorrectionSchema))
    dto: CreateFormalRankCorrectionDto,
    @CurrentUser() user: User,
  ): Promise<FormalRankCorrectionResponseDto> {
    return this.formalRankCorrectionService.request(sectionId, dto, user);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_CORRECTION_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(formalRankCorrectionQuerySchema))
    query: FormalRankCorrectionQueryDto,
  ): Promise<PaginatedResponse<FormalRankCorrectionResponseDto>> {
    return this.formalRankCorrectionService.list(sectionId, query);
  }

  @Get(':requestId')
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_CORRECTION_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('sectionId') sectionId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<FormalRankCorrectionResponseDto> {
    return this.formalRankCorrectionService.getById(sectionId, requestId);
  }

  @Post(':requestId/approve')
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_CORRECTION_REVIEW)
  @RequireGroupKind(GroupKind.SECTION)
  approve(
    @Param('sectionId') sectionId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: User,
  ): Promise<FormalRankCorrectionResponseDto> {
    return this.formalRankCorrectionService.approve(sectionId, requestId, user);
  }

  @Post(':requestId/reject')
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_CORRECTION_REVIEW)
  @RequireGroupKind(GroupKind.SECTION)
  reject(
    @Param('sectionId') sectionId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(new ZodValidationPipe(rejectFormalRankCorrectionSchema))
    dto: RejectFormalRankCorrectionDto,
    @CurrentUser() user: User,
  ): Promise<FormalRankCorrectionResponseDto> {
    return this.formalRankCorrectionService.reject(
      sectionId,
      requestId,
      dto,
      user,
    );
  }
}
