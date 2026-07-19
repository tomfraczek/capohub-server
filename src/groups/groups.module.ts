import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { GroupMembershipsService } from './group-memberships.service';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermissionService } from './permissions/group-permission.service';

// Entities are driven through the plain EntityManager (auto-discovered
// globally), so no forFeature() is needed. Group-level authorization is a
// self-contained system (GroupPermission/GroupRole), deliberately not
// wired to auth/permissions/permissions.module.ts - see
// group-role-permissions.map.ts.
@Module({
  controllers: [GroupsController],
  providers: [
    GroupsService,
    GroupMembershipsService,
    GroupPermissionService,
    GroupPermissionsGuard,
  ],
})
export class GroupsModule {}
