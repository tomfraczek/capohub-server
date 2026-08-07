import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  GroupKind,
  RequireGroupKind,
} from '../groups/decorators/require-group-kind.decorator';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { User } from '../users/entities/user.entity';
import {
  CancelTrainingDto,
  cancelTrainingSchema,
} from './dto/cancel-training.schema';
import {
  CreateTrainingDto,
  createTrainingSchema,
} from './dto/create-training.schema';
import {
  TrainingListQueryDto,
  trainingListQuerySchema,
} from './dto/training-list-query.schema';
import { TrainingResponseDto } from './dto/training-response.dto';
import {
  TrainingStatsQueryDto,
  trainingStatsQuerySchema,
} from './dto/training-stats-query.schema';
import { TrainingStatsResponseDto } from './dto/training-stats-response.dto';
import type { UpdateTrainingInput } from './dto/update-training.schema';
import { updateTrainingSchema } from './dto/update-training.schema';
import { TrainingListResult, TrainingsService } from './trainings.service';
import { TrainingStatsService } from './training-stats.service';

@Controller('sections/:sectionId/trainings')
export class TrainingsController {
  constructor(
    private readonly trainingsService: TrainingsService,
    private readonly trainingStatsService: TrainingStatsService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(GroupPermissionsGuard)
  @RequireGroupPermission(GroupPermission.TRAINING_MANAGE)
  @RequireGroupKind(GroupKind.SECTION)
  create(
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createTrainingSchema)) dto: CreateTrainingDto,
    @CurrentUser() user: User,
  ): Promise<TrainingResponseDto> {
    return this.trainingsService.create(sectionId, dto, user);
  }

  // Declared before ':trainingId' so it is never shadowed by that dynamic
  // segment (see GroupsModule/EventsModule's identical static-before-
  // dynamic route ordering elsewhere).
  @Get('stats')
  @UseGuards(GroupPermissionsGuard)
  @RequireGroupPermission(GroupPermission.TRAINING_STATS_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  stats(
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(trainingStatsQuerySchema))
    query: TrainingStatsQueryDto,
  ): Promise<TrainingStatsResponseDto> {
    return this.trainingStatsService.getStats(sectionId, query);
  }

  // No guard - visibility (MEMBERS_ONLY vs PUBLIC) is resolved per-Training
  // inside TrainingsService, same split as EventsController's list/getById
  // (a stranger with no Section membership may still legitimately see a
  // PUBLIC Training).
  @Get()
  list(
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(trainingListQuerySchema))
    query: TrainingListQueryDto,
    @CurrentUser() user: User,
  ): Promise<TrainingListResult> {
    return this.trainingsService.list(sectionId, user, query);
  }

  @Get(':trainingId')
  getById(
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @CurrentUser() user: User,
  ): Promise<TrainingResponseDto> {
    return this.trainingsService.getById(trainingId, user);
  }

  @Patch(':trainingId')
  @UseGuards(GroupPermissionsGuard)
  @RequireGroupPermission(GroupPermission.TRAINING_MANAGE)
  @RequireGroupKind(GroupKind.SECTION)
  update(
    @Param('sectionId') sectionId: string,
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @Body(new ZodValidationPipe(updateTrainingSchema)) dto: UpdateTrainingInput,
    @CurrentUser() user: User,
  ): Promise<TrainingResponseDto> {
    return this.trainingsService.update(sectionId, trainingId, dto, user);
  }

  @Post(':trainingId/cancel')
  @UseGuards(GroupPermissionsGuard)
  @RequireGroupPermission(GroupPermission.TRAINING_MANAGE)
  @RequireGroupKind(GroupKind.SECTION)
  cancel(
    @Param('sectionId') sectionId: string,
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @Body(new ZodValidationPipe(cancelTrainingSchema)) dto: CancelTrainingDto,
    @CurrentUser() user: User,
  ): Promise<TrainingResponseDto> {
    return this.trainingsService.cancel(sectionId, trainingId, dto, user);
  }
}
