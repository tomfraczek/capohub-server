import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  UpdateTrainingRsvpDto,
  updateTrainingRsvpSchema,
} from './dto/update-training-rsvp.schema';
import { TrainingRsvpResponseDto } from './dto/training-rsvp-response.dto';
import { TrainingRsvpService } from './training-rsvp.service';

// Flat, direct-by-id routes (not nested under sectionId) - a Training's
// RSVP is addressed independently of which Section it belongs to, same
// convention as EventRsvpController. Self-service only - no
// GroupPermissionsGuard anywhere here; eligibility is resolved from the
// Training's own visibility/allowExternalRsvp rule inside
// TrainingRsvpService (see the module spec §5/§6).
@Controller('trainings/:trainingId')
export class TrainingRsvpController {
  constructor(private readonly trainingRsvpService: TrainingRsvpService) {}

  @Put('rsvp')
  setRsvp(
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @Body(new ZodValidationPipe(updateTrainingRsvpSchema))
    dto: UpdateTrainingRsvpDto,
    @CurrentUser() user: User,
  ): Promise<TrainingRsvpResponseDto> {
    return this.trainingRsvpService.setRsvp(trainingId, dto, user);
  }

  @Delete('rsvp')
  @HttpCode(204)
  deleteRsvp(
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.trainingRsvpService.deleteRsvp(trainingId, user);
  }

  @Get('rsvps')
  listRsvps(
    @Param('trainingId', ParseUUIDPipe) trainingId: string,
    @CurrentUser() user: User,
  ): Promise<TrainingRsvpResponseDto[]> {
    return this.trainingRsvpService.listRsvps(trainingId, user);
  }
}
