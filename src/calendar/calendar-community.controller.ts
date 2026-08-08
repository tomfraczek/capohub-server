import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { uuidSchema } from '../songs/dto/song-validation.helpers';
import { User } from '../users/entities/user.entity';
import { CalendarService } from './calendar.service';
import {
  CalendarRangeQueryDto,
  calendarRangeQuerySchema,
} from './dto/calendar-range-query.schema';
import { CalendarResponseDto } from './dto/calendar-item.dto';

// Dual-mounted, same convention as EventsController: a Community is either
// a Group or a Section, and each kind gets its own, non-inherited calendar
// (module spec §5/§6 - no parent/child aggregation). No guard, same
// reasoning as EventsController/TrainingsController's own list()
// endpoints: a PUBLIC Event or Training must remain visible to a caller
// with no Community membership, so access is resolved per-item inside
// CalendarService (which itself only ever delegates to EventsService/
// TrainingsService - see calendar.service.ts).
@Controller(['groups/:groupId/calendar', 'sections/:sectionId/calendar'])
export class CalendarCommunityController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  getCommunityCalendar(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(calendarRangeQuerySchema))
    query: CalendarRangeQueryDto,
    @CurrentUser() user: User,
  ): Promise<CalendarResponseDto> {
    const communityId = groupId ?? sectionId;
    if (!uuidSchema.safeParse(communityId).success) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return groupId
      ? this.calendarService.getGroupCalendar(groupId, user, query)
      : this.calendarService.getSectionCalendar(sectionId, user, query);
  }
}
