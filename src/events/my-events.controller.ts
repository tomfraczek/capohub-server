import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  EventListQueryDto,
  eventListQuerySchema,
} from './dto/event-list-query.schema';
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
}
