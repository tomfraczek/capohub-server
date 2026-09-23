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

// Entities (including Group/Section/Event, looked up directly for optional
// evidence links on MANUAL entries) are driven through the plain
// EntityManager (auto-discovered globally, see
// mikro-orm-options.factory.ts), so no forFeature() is needed - same
// convention as every other module. Imports GraduationModule for
// FormalRankCorrectionService (RECEIVED_RANK's visibility during an active
// correction), StorageModule for R2StorageService (event/community image
// URLs on linked-Event refs), and EventsModule for EventAccessService
// (whether a non-owner viewer may see a linked Event's own details - see
// career-timeline-aggregation.service.ts's isEventVisibleToViewer) - all
// reused rather than re-derived. Neither imported module needs anything
// back from here, so there is nothing to export.
//
// MyCareerTimelineController ('users/me/career-timeline') is registered
// before CareerTimelineController ('users/:userId/career-timeline') so the
// literal `me` route wins for GET /users/me/career-timeline - same
// static-before-wildcard ordering as UsersController's `me/profile` vs
// `:userId/profile`.
@Module({
  imports: [GraduationModule, StorageModule, EventsModule],
  controllers: [
    MyCareerTimelineController,
    CareerTimelineController,
    CareerTimelineEntriesController,
  ],
  providers: [CareerTimelineAggregationService, CareerTimelineEntriesService],
})
export class CareerTimelineModule {}
