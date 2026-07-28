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
  AssignGuardianDto,
  assignGuardianSchema,
} from './dto/assign-guardian.schema';
import { EventGuardianAssignmentResponseDto } from './dto/event-guardian-response.dto';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventPermission } from './permissions/event-permission.enum';
import { EventGuardiansService } from './event-guardians.service';

@Controller('events/:eventId')
@UseGuards(EventPermissionsGuard)
@RequireEventPermission(EventPermission.EVENT_MANAGE_PARTICIPANTS)
export class EventGuardiansController {
  constructor(private readonly eventGuardiansService: EventGuardiansService) {}

  @Get('guardians')
  list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventGuardianAssignmentResponseDto[]> {
    return this.eventGuardiansService.list(eventId);
  }

  @Post('attendees/:attendeeId/guardian')
  assign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
    @Body(new ZodValidationPipe(assignGuardianSchema)) dto: AssignGuardianDto,
    @CurrentUser() user: User,
  ): Promise<EventGuardianAssignmentResponseDto> {
    return this.eventGuardiansService.assign(eventId, attendeeId, dto, user);
  }

  @Delete('attendees/:attendeeId/guardian')
  @HttpCode(204)
  revoke(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
  ): Promise<void> {
    return this.eventGuardiansService.revoke(eventId, attendeeId);
  }
}
