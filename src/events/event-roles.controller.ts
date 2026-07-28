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
  GrantEventRoleDto,
  grantEventRoleSchema,
} from './dto/grant-event-role.schema';
import {
  TransferEventOwnershipDto,
  transferEventOwnershipSchema,
} from './dto/transfer-event-ownership.schema';
import { EventRoleAssignmentResponseDto } from './dto/event-role-assignment-response.dto';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventPermission } from './permissions/event-permission.enum';
import { EventRolesService } from './event-roles.service';

@Controller('events/:eventId')
@UseGuards(EventPermissionsGuard)
export class EventRolesController {
  constructor(private readonly eventRolesService: EventRolesService) {}

  @Get('roles')
  @RequireEventPermission(EventPermission.EVENT_VIEW_MANAGEMENT)
  list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventRoleAssignmentResponseDto[]> {
    return this.eventRolesService.listRoles(eventId);
  }

  // The guard only guarantees EVENT_MANAGE_MODERATORS here (i.e. ORGANIZER
  // or OWNER); granting ORGANIZER specifically is further restricted to
  // OWNER inside the service - see EventRolesService.grantRole.
  @Post('roles')
  @HttpCode(201)
  @RequireEventPermission(EventPermission.EVENT_MANAGE_MODERATORS)
  grant(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(grantEventRoleSchema)) dto: GrantEventRoleDto,
    @CurrentUser() user: User,
  ): Promise<EventRoleAssignmentResponseDto> {
    return this.eventRolesService.grantRole(eventId, dto, user);
  }

  @Delete('roles/:roleAssignmentId')
  @HttpCode(204)
  @RequireEventPermission(EventPermission.EVENT_MANAGE_MODERATORS)
  revoke(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('roleAssignmentId', ParseUUIDPipe) roleAssignmentId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.eventRolesService.revokeRole(eventId, roleAssignmentId, user);
  }

  @Post('transfer-ownership')
  @RequireEventPermission(EventPermission.EVENT_OWNERSHIP_TRANSFER)
  transferOwnership(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(transferEventOwnershipSchema))
    dto: TransferEventOwnershipDto,
    @CurrentUser() user: User,
  ): Promise<EventRoleAssignmentResponseDto> {
    return this.eventRolesService.transferOwnership(eventId, dto, user);
  }
}
