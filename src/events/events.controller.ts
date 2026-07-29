import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { uuidSchema } from '../songs/dto/song-validation.helpers';
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
// visible to non-members too (see events-api.md "Visibility"). A Community
// is a Group or a Section (see event.entity.ts) - dual-mounted, since
// EventsService already resolves either generically (no root-only
// restriction), matching the same pattern as RoleAssignmentsController/
// AcademiesController/CohortsController in the Groups module.
@Controller(['groups/:groupId/events', 'sections/:sectionId/events'])
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(GroupPermissionsGuard)
  @RequireGroupPermission(GroupPermission.EVENT_CREATE)
  create(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createEventSchema)) dto: CreateEventDto,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.create(groupId ?? sectionId, dto, user);
  }

  // No guard here (see the class comment - PUBLIC Events must remain
  // visible to non-members), so the id format is validated by hand
  // instead of relying on ParseUUIDPipe (which can't apply to a param
  // that's undefined on whichever route didn't match - see
  // RoleAssignmentsController for the same dual-mount shape, guarded
  // there, so no such gap) or on the guard's own uuidSchema check.
  @Get()
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(eventListQuerySchema))
    query: EventListQueryDto,
    @CurrentUser() user: User,
  ): Promise<EventListResult> {
    const communityId = groupId ?? sectionId;
    if (!uuidSchema.safeParse(communityId).success) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return this.eventsService.list(communityId, user, query);
  }
}
