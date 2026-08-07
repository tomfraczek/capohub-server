import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { TrainingAccessService } from './training-access.service';
import { TrainingAttendanceController } from './training-attendance.controller';
import { TrainingAttendanceService } from './training-attendance.service';
import { TrainingNotificationsService } from './training-notifications.service';
import { TrainingPlanNotesController } from './training-plan-notes.controller';
import { TrainingRsvpController } from './training-rsvp.controller';
import { TrainingRsvpService } from './training-rsvp.service';
import { TrainingSeriesController } from './training-series.controller';
import { TrainingSeriesService } from './training-series.service';
import { TrainingStatsService } from './training-stats.service';
import { TrainingsController } from './trainings.controller';
import { TrainingsService } from './trainings.service';

// Entities are driven through the plain EntityManager (auto-discovered
// globally), so no forFeature() is needed - same convention as
// GroupsModule/EventsModule. Imports GroupsModule to reuse its
// Section-level authorization machinery (RoleAssignmentsService,
// GroupPermissionService, GroupPermissionsGuard, AuditLogService) rather
// than duplicating it - never the reverse (ADR-024: Group Domain
// independence).
@Module({
  imports: [GroupsModule],
  controllers: [
    TrainingsController,
    TrainingSeriesController,
    TrainingRsvpController,
    TrainingAttendanceController,
    TrainingPlanNotesController,
  ],
  providers: [
    TrainingAccessService,
    TrainingsService,
    TrainingSeriesService,
    TrainingRsvpService,
    TrainingAttendanceService,
    TrainingStatsService,
    TrainingNotificationsService,
  ],
  // TrainingsService is exported for HomeModule, which reuses
  // findNearestForViewer as-is (same viewer-scoped visibility rule GET
  // .../trainings itself runs) rather than re-querying Trainings itself -
  // same precedent as EventsModule exporting EventsService for the same
  // reason.
  exports: [TrainingsService],
})
export class TrainingsModule {}
