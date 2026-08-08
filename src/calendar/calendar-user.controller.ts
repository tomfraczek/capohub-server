import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CalendarService } from './calendar.service';
import {
  CalendarRangeQueryDto,
  calendarRangeQuerySchema,
} from './dto/calendar-range-query.schema';
import { CalendarResponseDto } from './dto/calendar-item.dto';

// "My plan", read-only - see CalendarService.getUserCalendar's own comment
// for exactly what counts as "mine". No guard: every authenticated user
// has a calendar, there is no community-level permission to hold here.
@Controller('users/me/calendar')
export class CalendarUserController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  getMyCalendar(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(calendarRangeQuerySchema))
    query: CalendarRangeQueryDto,
  ): Promise<CalendarResponseDto> {
    return this.calendarService.getUserCalendar(user, query);
  }
}
