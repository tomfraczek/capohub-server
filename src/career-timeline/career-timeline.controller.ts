import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CareerTimelineAggregationService } from './career-timeline-aggregation.service';
import { careerTimelineQuerySchema } from './dto/career-timeline-query.schema';
import type { CareerTimelineQueryInput } from './dto/career-timeline-query.schema';
import { CareerTimelineResponseDto } from './dto/career-timeline-response.dto';

// GET /users/me/career-timeline - the caller's own timeline, always full
// (isOwner bypasses every privacy toggle - see
// CareerTimelineAggregationService).
@Controller('users/me/career-timeline')
export class MyCareerTimelineController {
  constructor(
    private readonly aggregationService: CareerTimelineAggregationService,
  ) {}

  @Get()
  getOwn(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(careerTimelineQuerySchema))
    query: CareerTimelineQueryInput,
  ): Promise<CareerTimelineResponseDto> {
    return this.aggregationService.getTimeline(user, user.id, query);
  }
}

// GET /users/:userId/career-timeline - another user's timeline, filtered
// per-viewer by CareerTimelineAggregationService (empty result, not an
// error, when the target's showCareerTimeline is off - same "never error
// just because something is private" convention as
// UserProfileService.getPublicProfile).
@Controller('users/:userId/career-timeline')
export class CareerTimelineController {
  constructor(
    private readonly aggregationService: CareerTimelineAggregationService,
  ) {}

  @Get()
  getForUser(
    @CurrentUser() viewer: User,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query(new ZodValidationPipe(careerTimelineQuerySchema))
    query: CareerTimelineQueryInput,
  ): Promise<CareerTimelineResponseDto> {
    return this.aggregationService.getTimeline(viewer, userId, query);
  }
}
