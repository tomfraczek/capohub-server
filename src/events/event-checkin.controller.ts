import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CheckInIdentifyDto,
  checkInIdentifySchema,
  MarkCheckInDto,
  markCheckInSchema,
} from './dto/checkin.schema';
import { EventAttendeeResponseDto } from './dto/event-attendee-response.dto';
import { EventCheckInIdentifyResponseDto } from './dto/event-checkin-identify-response.dto';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventPermission } from './permissions/event-permission.enum';
import { EventCheckInService } from './event-checkin.service';

@Controller('events/:eventId/checkin')
@UseGuards(EventPermissionsGuard)
@RequireEventPermission(EventPermission.EVENT_CHECKIN)
export class EventCheckInController {
  constructor(private readonly eventCheckInService: EventCheckInService) {}

  // Resolves a scanned/typed check-in code to a person, plus any children
  // the scanned user is currently the active guardian for on this Event -
  // see event-checkin.service.ts.
  @Post('identify')
  identify(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(checkInIdentifySchema)) dto: CheckInIdentifyDto,
  ): Promise<EventCheckInIdentifyResponseDto> {
    return this.eventCheckInService.identify(eventId, dto.code);
  }

  @Post(':attendeeId')
  markPresent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
    @Body(new ZodValidationPipe(markCheckInSchema)) dto: MarkCheckInDto,
    @CurrentUser() user: User,
  ): Promise<EventAttendeeResponseDto> {
    return this.eventCheckInService.markPresent(
      eventId,
      attendeeId,
      dto.method,
      user,
    );
  }

  @Post(':attendeeId/undo')
  undo(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
  ): Promise<EventAttendeeResponseDto> {
    return this.eventCheckInService.undoCheckIn(eventId, attendeeId);
  }
}
