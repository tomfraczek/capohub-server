import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { GraduationModule } from '../graduation/graduation.module';
import { StorageModule } from '../storage/storage.module';
import { CareerTimelineAggregationService } from './career-timeline-aggregation.service';
import { CareerTimelineEntriesController } from './career-timeline-entries.controller';
import { CareerTimelineEntriesService } from './career-timeline-entries.service';
import {
  CareerTimelineController,
  MyCareerTimelineController,
} from './career-timeline.controller';

// Entities are driven through the plain EntityManager (auto-discovered
// globally, see mikro-orm-options.factory.ts), so no forFeature() is
// needed - same convention as every other module. Imports EventsModule for
// EventAccessService (EVENT entry visibility) and GraduationModule for
// FormalRankCorrectionService (FORMAL_RANK entry visibility during an
// active correction) - both reused rather than re-derived, see
// career-timeline-aggregation.service.ts. Neither imported module needs
// anything back from here, so there is nothing to export.
//
// MyCareerTimelineController ('users/me/career-timeline') is registered
// before CareerTimelineController ('users/:userId/career-timeline') so the
// literal `me` route wins for GET /users/me/career-timeline - same
// static-before-wildcard ordering as UsersController's `me/profile` vs
// `:userId/profile`.
@Module({
  imports: [EventsModule, GraduationModule, StorageModule],
  controllers: [
    MyCareerTimelineController,
    CareerTimelineController,
    CareerTimelineEntriesController,
  ],
  providers: [CareerTimelineAggregationService, CareerTimelineEntriesService],
})
export class CareerTimelineModule {}
