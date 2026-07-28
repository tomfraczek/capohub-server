import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CancelEventDto, cancelEventSchema } from './dto/cancel-event.schema';
import { EventResponseDto } from './dto/event-response.dto';
import { EventStatusHistoryResponseDto } from './dto/event-status-history-response.dto';
import { UpdateEventDto, updateEventSchema } from './dto/update-event.schema';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventPermission } from './permissions/event-permission.enum';
import { EventsService } from './events.service';
import { EventHistoryService } from './event-history.service';

// Flat, direct-by-id routes (not nested under groupId): once an Event
// exists it is independently addressable (invite links, QR posters,
// check-in) regardless of which community it belongs to - see
// event.entity.ts. Detail reads are visibility-gated inside EventsService,
// never by EventPermissionsGuard (a stranger with no Event role can still
// legitimately view a PUBLIC Event) - the guard only applies to the
// write/management actions below.
@Controller('events/:eventId')
export class EventController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventHistoryService: EventHistoryService,
  ) {}

  @Get()
  getById(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.getById(eventId, user);
  }

  @Patch()
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_EDIT)
  update(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(updateEventSchema)) dto: UpdateEventDto,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.update(eventId, dto, user);
  }

  @Post('publish')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_PUBLISH)
  publish(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.publish(eventId, user);
  }

  @Post('cancel')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_CANCEL)
  cancel(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(cancelEventSchema)) dto: CancelEventDto,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.cancel(eventId, dto, user);
  }

  @Post('finish')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_FINISH)
  finish(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.finish(eventId, user);
  }

  @Get('history')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_VIEW_MANAGEMENT)
  history(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventStatusHistoryResponseDto[]> {
    return this.eventHistoryService.list(eventId);
  }
}
