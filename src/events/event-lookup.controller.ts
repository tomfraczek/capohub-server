import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
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

  // "Scan Event QR -> open Event Details" (module spec §14) - a query
  // param, not a path segment, since a raw QR payload contains colons
  // ("capohub:v1:f:123456"). Declared before nothing dynamic could shadow
  // it (this controller has no other `by-*` route shaped like a single
  // segment), so no route-ordering concern here.
  @Get('by-qr')
  getByQrPayload(
    @Query('payload') payload: string | undefined,
    @CurrentUser() viewer: User,
  ): Promise<EventResponseDto> {
    if (!payload) {
      throw new BadRequestException({
        code: 'MISSING_QR_PAYLOAD',
        message: 'payload query parameter is required',
      });
    }
    return this.eventsService.getByQrPayload(payload, viewer);
  }
}
