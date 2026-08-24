import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateEventDto, createEventSchema } from './dto/create-event.schema';
import {
  EventListQueryDto,
  eventListQuerySchema,
} from './dto/event-list-query.schema';
import { EventResponseDto } from './dto/event-response.dto';
import { EventListResult } from './events.service';
import { EventsService } from './events.service';

// Flat, viewer-scoped route - the "global events" feed (see
// events-api.md § Global Events): every Event visible to the caller across
// every Community they belong to, have an Event role in, or hold an
// invitation for, in one request. Exists so the frontend building a single
// cross-community Events screen never has to fetch every Group/Section the
// user belongs to and issue one GET .../events request per community
// itself. Open to any signed-in user, same as EventsController.list - a
// PUBLIC Event must remain visible to non-members, so this is never gated
// by a fixed GroupPermission.
//
// Also owns POST (create an Event organized by the caller themselves,
// never a Group/Section - see event-community.util.ts and
// EventsService.createPersonal) - the User-organizer counterpart to
// EventsController's community-scoped POST groups/:groupId/events and
// POST sections/:sectionId/events. Gated by authentication only (no
// GroupPermission/EventPermission applies - there is no Community and no
// Event yet to hold one): any signed-in User may create an Event as
// themselves, and structurally only as themselves - CreateEventDto has no
// organizer-identity field for a caller to substitute another User's
// identity here.
@Controller('events')
export class MyEventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(eventListQuerySchema))
    query: EventListQueryDto,
    @CurrentUser() user: User,
  ): Promise<EventListResult> {
    return this.eventsService.listForViewer(user, query);
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createEventSchema)) dto: CreateEventDto,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.createPersonal(dto, user);
  }
}
