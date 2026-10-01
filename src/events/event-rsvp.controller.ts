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
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { EventAttendeeResponseDto } from './dto/event-attendee-response.dto';
import { EventParticipantResponseDto } from './dto/event-participant-response.dto';
import {
  RegisterForEventDto,
  registerForEventSchema,
} from './dto/register-for-event.schema';
import { UpdateRsvpDto, updateRsvpSchema } from './dto/update-rsvp.schema';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventPermission } from './permissions/event-permission.enum';
import { EventRsvpService } from './event-rsvp.service';

@Controller('events/:eventId')
export class EventRsvpController {
  constructor(private readonly eventRsvpService: EventRsvpService) {}

  // Self-service - no EventPermissionsGuard: any authenticated user may
  // attempt to register, eligibility is resolved from the Event's own
  // visibility/membership/invitation rules inside the service (see
  // EventAccessService.canViewerRegister), never from an Event role.
  @Post('register')
  @HttpCode(201)
  register(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(registerForEventSchema))
    dto: RegisterForEventDto,
    @CurrentUser() user: User,
  ): Promise<EventAttendeeResponseDto[]> {
    return this.eventRsvpService.register(eventId, dto, user);
  }

  @Patch('rsvp/:attendeeId')
  updateRsvp(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
    @Body(new ZodValidationPipe(updateRsvpSchema)) dto: UpdateRsvpDto,
    @CurrentUser() user: User,
  ): Promise<EventAttendeeResponseDto> {
    return this.eventRsvpService.updateRsvp(eventId, attendeeId, dto, user);
  }

  @Get('my-registrations')
  myRegistrations(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventAttendeeResponseDto[]> {
    return this.eventRsvpService.listMyRegistrations(eventId, user);
  }

  @Get('participants')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_MANAGE_PARTICIPANTS)
  participants(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventParticipantResponseDto[]> {
    return this.eventRsvpService.listParticipants(eventId);
  }

  @Post('participants/:attendeeId/promote')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_MANAGE_PARTICIPANTS)
  promote(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
  ): Promise<EventAttendeeResponseDto> {
    return this.eventRsvpService.promoteFromWaitlist(eventId, attendeeId);
  }
}
