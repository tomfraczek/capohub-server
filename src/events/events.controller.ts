import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateEventDto, createEventSchema } from './dto/create-event.schema';
import {
  EventListQueryDto,
  eventListQuerySchema,
} from './dto/event-list-query.schema';
import { EventListResult } from './events.service';
import { EventResponseDto } from './dto/event-response.dto';
import { EventsService } from './events.service';

// Community-scoped: creating an Event requires GroupPermission.EVENT_CREATE
// for the owning community (Admin/Owner tier - see
// group-role-permissions.map.ts); listing is open to any authenticated
// user, with per-Event visibility resolved inside EventsService.list -
// never gated by a fixed GroupPermission, since PUBLIC Events must remain
// visible to non-members too (see events-api.md "Visibility").
@Controller('groups/:groupId/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(GroupPermissionsGuard)
  @RequireGroupPermission(GroupPermission.EVENT_CREATE)
  create(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(createEventSchema)) dto: CreateEventDto,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.create(groupId, dto, user);
  }

  @Get()
  list(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query(new ZodValidationPipe(eventListQuerySchema))
    query: EventListQueryDto,
    @CurrentUser() user: User,
  ): Promise<EventListResult> {
    return this.eventsService.list(groupId, user, query);
  }
}
