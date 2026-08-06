import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { CustomUserRanksController } from './custom-user-ranks.controller';
import { CustomUserRankService } from './custom-user-rank.service';
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
// One-directional: GroupsModule never imports this module back. Nothing
// outside this module needs anything it exports, so there is nothing to
// export - UsersModule does NOT need to import this module, since
// /users/me/formal-rank*, /users/me/custom-ranks* and
// /users/me/formal-rank-correction* all live here directly rather than on
// UsersController.
@Module({
  imports: [GroupsModule],
  controllers: [
    GraduationSystemController,
    RanksController,
    FormalRankController,
    FormalRankHistoryController,
    CustomUserRanksController,
    FormalRankCorrectionsController,
    MyFormalRankCorrectionController,
  ],
  providers: [
    GraduationSystemService,
    RanksService,
    FormalRankService,
    CustomUserRankService,
    FormalRankCorrectionService,
  ],
})
export class GraduationModule {}
