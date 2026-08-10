import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  EventCheckInDto,
  eventCheckInSchema,
  RecordEventAttendanceDto,
  recordEventAttendanceSchema,
} from './dto/event-attendance-mutation.schema';
import {
  EventAttendanceEntryDto,
  EventAttendanceIdentifyResponseDto,
  EventAttendanceRosterResponseDto,
  EventCheckInResultDto,
} from './dto/event-attendance.dto';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventAttendanceService } from './event-attendance.service';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { EventPermission } from './permissions/event-permission.enum';

// The sole Event check-in/attendance surface - the legacy publicCode/
// attendeeId-based check-in system has been removed entirely, not kept
// alongside this one as a deprecated fallback. Every route here reuses the
// exact same EventRole authorization model (EventPermissionsGuard +
// EventPermission.EVENT_CHECKIN/EVENT_VIEW_MANAGEMENT - both granted to
// MODERATOR and above, see event-role-permissions.map.ts).
@Controller('events/:eventId')
@UseGuards(EventPermissionsGuard)
export class EventAttendanceController {
  constructor(
    private readonly eventAttendanceService: EventAttendanceService,
  ) {}

  @Get('attendance')
  @RequireEventPermission(EventPermission.EVENT_VIEW_MANAGEMENT)
  listRoster(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventAttendanceRosterResponseDto> {
    return this.eventAttendanceService.listRoster(eventId);
  }

  // Zero-mutation lookup (module spec §6) - identifying check-in candidates
  // is the same organizational action as actually checking someone in, so
  // it requires the same permission (module spec §13), not a weaker one.
  @Post('attendance/identify')
  @RequireEventPermission(EventPermission.EVENT_CHECKIN)
  identify(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(eventCheckInSchema)) dto: EventCheckInDto,
  ): Promise<EventAttendanceIdentifyResponseDto> {
    return this.eventAttendanceService.identifyByIdentity(
      eventId,
      dto.identity,
    );
  }

  @Put('attendance/:userId')
  @RequireEventPermission(EventPermission.EVENT_CHECKIN)
  recordAttendance(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(recordEventAttendanceSchema))
    dto: RecordEventAttendanceDto,
    @CurrentUser() actor: User,
  ): Promise<EventAttendanceEntryDto> {
    return this.eventAttendanceService.recordAttendance(
      eventId,
      userId,
      dto.attended,
      actor,
    );
  }

  // Attendee-addressed variant (module spec §10) - the only way to record
  // attendance for a CHILD_DEPENDENT, which has no User.id to key the route
  // above off. No ordering hazard vs. `attendance/:userId` above despite
  // the shared `attendance` prefix - this is a 3-segment path
  // (`attendance/attendees/:attendeeId`), the other a 2-segment one
  // (`attendance/:userId`), so they can never shadow each other regardless
  // of declaration order.
  @Put('attendance/attendees/:attendeeId')
  @RequireEventPermission(EventPermission.EVENT_CHECKIN)
  recordAttendanceByAttendeeId(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
    @Body(new ZodValidationPipe(recordEventAttendanceSchema))
    dto: RecordEventAttendanceDto,
    @CurrentUser() actor: User,
  ): Promise<EventAttendanceEntryDto> {
    return this.eventAttendanceService.recordAttendanceByAttendeeId(
      eventId,
      attendeeId,
      dto.attended,
      actor,
    );
  }

  @Post('check-in')
  @RequireEventPermission(EventPermission.EVENT_CHECKIN)
  checkIn(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(eventCheckInSchema)) dto: EventCheckInDto,
    @CurrentUser() actor: User,
  ): Promise<EventCheckInResultDto> {
    return this.eventAttendanceService.checkInByIdentity(
      eventId,
      dto.identity,
      actor,
    );
  }
}
