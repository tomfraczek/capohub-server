import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { CustomUserRanksController } from './custom-user-ranks.controller';
import { CustomUserRankService } from './custom-user-rank.service';
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
// Imports GroupsModule for GroupPermissionsGuard (catalog authorization -
// see graduation-system.controller.ts/ranks.controller.ts) and
// AuditLogService (catalog mutations only - see the module spec: a user's
// own rank change is never logged there). One-directional: GroupsModule
// never imports this module back. Nothing outside this module needs
// anything it exports, so there is nothing to export - UsersModule does
// NOT need to import this module, since /users/me/formal-rank* and
// /users/me/custom-ranks* live here directly rather than on
// UsersController.
@Module({
  imports: [GroupsModule],
  controllers: [
    GraduationSystemController,
    RanksController,
    FormalRankController,
    FormalRankHistoryController,
    CustomUserRanksController,
  ],
  providers: [
    GraduationSystemService,
    RanksService,
    FormalRankService,
    CustomUserRankService,
  ],
})
export class GraduationModule {}
