import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { EventResponseDto } from './dto/event-response.dto';
import { EventsService } from './events.service';

// Flat, separate from EventController (`events/:eventId`) - a route
// literal ("by-code") can never share a controller base with a dynamic
// `:eventId` segment at the same position, so this small lookup surface
// gets its own controller (see the module spec §10/§11: a dedicated lookup
// endpoint, not a duplicated EventAccessService).
@Controller('events')
export class EventLookupController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('by-code/:type/:code')
  getByCode(
    @Param('type') type: string,
    @Param('code') code: string,
    @CurrentUser() viewer: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.getByTypeAndCode(type, code, viewer);
  }
}
