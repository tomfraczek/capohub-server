import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomUserRanksController } from './custom-user-ranks.controller';
import { CustomUserRankService } from './custom-user-rank.service';
import { FormalRankOptionsController } from './formal-rank-options.controller';
import { MyFormalRankCorrectionController } from './formal-rank-correction-own.controller';
import { FormalRankCorrectionService } from './formal-rank-correction.service';
import { FormalRankCorrectionsController } from './formal-rank-corrections.controller';
import {
  FormalRankController,
  FormalRankHistoryController,
} from './formal-rank.controller';
import { FormalRankService } from './formal-rank.service';
import { GraduationSystemController } from './graduation-system.controller';
import { GraduationSystemService } from './graduation-system.service';
import { RanksController } from './ranks.controller';
import { RanksService } from './ranks.service';
import { SectionMemberFormalRankController } from './section-member-formal-rank.controller';

// Entities are driven through the plain EntityManager (auto-discovered
// globally, see mikro-orm-options.factory.ts's entitiesTs glob) - same as
// GroupsModule, no forFeature() needed.
//
// Imports GroupsModule for GroupPermissionsGuard (catalog authorization,
// and formal-rank-correction Section authorization - see
// graduation-system.controller.ts/ranks.controller.ts/
// formal-rank-corrections.controller.ts), AuditLogService (catalog
// mutations and the correction workflow, always under the exact Group/
// Section - see the module spec), and RoleAssignmentsService (variant-C
// review authorization - see FormalRankCorrectionService.assertCanReview).
// Imports EventsModule for EventAccessService, used by FormalRankService to
// validate an optional rank<->Event evidence link (see
// loadAndValidateEventLink). One-directional: neither GroupsModule nor
// EventsModule imports this module back.
//
// Exports FormalRankCorrectionService for CareerTimelineModule, which reuses
// isPubliclyVisible to gate FORMAL_RANK timeline entries during an active
// correction rather than re-deriving that rule (see
// career-timeline-aggregation.service.ts). UsersModule still does NOT need
// to import this module - /users/me/formal-rank*, /users/me/custom-ranks*
// and /users/me/formal-rank-correction* all live here directly rather than
// on UsersController.
@Module({
  imports: [GroupsModule, EventsModule, NotificationsModule],
  controllers: [
    GraduationSystemController,
    RanksController,
    FormalRankController,
    FormalRankHistoryController,
    CustomUserRanksController,
    FormalRankCorrectionsController,
    MyFormalRankCorrectionController,
    FormalRankOptionsController,
    SectionMemberFormalRankController,
  ],
  providers: [
    GraduationSystemService,
    RanksService,
    FormalRankService,
    CustomUserRankService,
    FormalRankCorrectionService,
  ],
  exports: [FormalRankCorrectionService],
})
export class GraduationModule {}
