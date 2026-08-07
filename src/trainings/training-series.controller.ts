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
import {
  GroupKind,
  RequireGroupKind,
} from '../groups/decorators/require-group-kind.decorator';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { User } from '../users/entities/user.entity';
import {
  CancelTrainingSeriesDto,
  cancelTrainingSeriesSchema,
} from './dto/cancel-training-series.schema';
import {
  CreateTrainingSeriesDto,
  createTrainingSeriesSchema,
} from './dto/create-training-series.schema';
import { TrainingSeriesResponseDto } from './dto/training-series-response.dto';
import {
  UpdateTrainingSeriesDto,
  updateTrainingSeriesSchema,
} from './dto/update-training-series.schema';
import { TrainingSeriesService } from './training-series.service';

@Controller('sections/:sectionId/training-series')
@UseGuards(GroupPermissionsGuard)
@RequireGroupKind(GroupKind.SECTION)
export class TrainingSeriesController {
  constructor(private readonly trainingSeriesService: TrainingSeriesService) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.TRAINING_MANAGE)
  create(
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createTrainingSeriesSchema))
    dto: CreateTrainingSeriesDto,
    @CurrentUser() user: User,
  ): Promise<TrainingSeriesResponseDto> {
    return this.trainingSeriesService.create(sectionId, dto, user);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.TRAINING_VIEW)
  list(
    @Param('sectionId') sectionId: string,
  ): Promise<TrainingSeriesResponseDto[]> {
    return this.trainingSeriesService.list(sectionId);
  }

  @Get(':seriesId')
  @RequireGroupPermission(GroupPermission.TRAINING_VIEW)
  getById(
    @Param('sectionId') sectionId: string,
    @Param('seriesId', ParseUUIDPipe) seriesId: string,
  ): Promise<TrainingSeriesResponseDto> {
    return this.trainingSeriesService.getById(sectionId, seriesId);
  }

  @Patch(':seriesId')
  @RequireGroupPermission(GroupPermission.TRAINING_MANAGE)
  update(
    @Param('sectionId') sectionId: string,
    @Param('seriesId', ParseUUIDPipe) seriesId: string,
    @Body(new ZodValidationPipe(updateTrainingSeriesSchema))
    dto: UpdateTrainingSeriesDto,
    @CurrentUser() user: User,
  ): Promise<TrainingSeriesResponseDto> {
    return this.trainingSeriesService.update(sectionId, seriesId, dto, user);
  }

  @Post(':seriesId/cancel')
  @RequireGroupPermission(GroupPermission.TRAINING_MANAGE)
  cancel(
    @Param('sectionId') sectionId: string,
    @Param('seriesId', ParseUUIDPipe) seriesId: string,
    @Body(new ZodValidationPipe(cancelTrainingSeriesSchema))
    dto: CancelTrainingSeriesDto,
    @CurrentUser() user: User,
  ): Promise<TrainingSeriesResponseDto> {
    return this.trainingSeriesService.cancel(sectionId, seriesId, dto, user);
  }
}
