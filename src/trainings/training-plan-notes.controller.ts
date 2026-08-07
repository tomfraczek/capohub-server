import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  UpdateTrainingPlanNotesDto,
  updateTrainingPlanNotesSchema,
} from './dto/update-training-plan-notes.schema';
import { TrainingResponseDto } from './dto/training-response.dto';
import { TrainingsService } from './trainings.service';

// Deliberately its own controller/endpoint, not folded into
// TrainingsController's PATCH - see update-training-plan-notes.schema.ts:
// this Training's own trainer may reach it without holding
// GroupPermission.TRAINING_MANAGE (see TrainingAccessService.
// canManagePrivateFields), so it cannot sit behind GroupPermissionsGuard.
@Controller('trainings/:trainingId')
export class TrainingPlanNotesController {
  constructor(private readonly trainingsService: TrainingsService) {}

  @Patch('plan-notes')
  update(
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @Body(new ZodValidationPipe(updateTrainingPlanNotesSchema))
    dto: UpdateTrainingPlanNotesDto,
    @CurrentUser() user: User,
  ): Promise<TrainingResponseDto> {
    return this.trainingsService.updatePlanNotes(trainingId, dto, user);
  }
}
