import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateEventInvitationDto,
  createEventInvitationSchema,
} from './dto/create-event-invitation.schema';
import { EventInvitationResponseDto } from './dto/event-invitation-response.dto';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventPermission } from './permissions/event-permission.enum';
import { EventInvitationsService } from './event-invitations.service';

@Controller('events/:eventId/invitations')
export class EventInvitationsController {
  constructor(
    private readonly eventInvitationsService: EventInvitationsService,
  ) {}

  @Get()
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_VIEW_MANAGEMENT)
  list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventInvitationResponseDto[]> {
    return this.eventInvitationsService.list(eventId);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_MANAGE_INVITATIONS)
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(createEventInvitationSchema))
    dto: CreateEventInvitationDto,
    @CurrentUser() user: User,
  ): Promise<EventInvitationResponseDto> {
    return this.eventInvitationsService.create(eventId, dto, user);
  }

  @Delete(':invitationId')
  @HttpCode(204)
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_MANAGE_INVITATIONS)
  cancel(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.eventInvitationsService.cancel(eventId, invitationId);
  }

  // Self-service - the invited person declining. Deliberately not behind
  // EventPermissionsGuard: the invitee usually holds no Event role at all.
  @Post(':invitationId/decline')
  decline(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.eventInvitationsService.decline(eventId, invitationId, user);
  }
}
