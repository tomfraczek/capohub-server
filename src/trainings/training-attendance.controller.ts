import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  RecordTrainingAttendanceDto,
  recordTrainingAttendanceSchema,
} from './dto/record-training-attendance.schema';
import {
  TrainingAttendanceResponseDto,
  TrainingAttendanceRosterEntryDto,
} from './dto/training-attendance-response.dto';
import { TrainingAttendanceService } from './training-attendance.service';

// Flat, direct-by-id routes, same convention as TrainingRsvpController - no
// GroupPermissionsGuard here either: authorization is the resource-level
// trainer override plus GroupPermission.TRAINING_ATTENDANCE_MANAGE,
// resolved inside TrainingAttendanceService (see the module spec §3/§7),
// which GroupPermissionsGuard cannot express (it would 404 out an external
// trainer who holds no SectionMembership at all).
@Controller('trainings/:trainingId')
export class TrainingAttendanceController {
  constructor(
    private readonly trainingAttendanceService: TrainingAttendanceService,
  ) {}

  @Get('attendance')
  listRoster(
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @CurrentUser() user: User,
  ): Promise<TrainingAttendanceRosterEntryDto[]> {
    return this.trainingAttendanceService.listRoster(trainingId, user);
  }

  @Put('attendance/:userId')
  record(
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(recordTrainingAttendanceSchema))
    dto: RecordTrainingAttendanceDto,
    @CurrentUser() user: User,
  ): Promise<TrainingAttendanceResponseDto> {
    return this.trainingAttendanceService.record(trainingId, userId, dto, user);
  }
}
