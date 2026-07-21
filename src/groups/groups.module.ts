import { Module } from '@nestjs/common';
import { AcademiesController } from './academies.controller';
import { AcademiesService } from './academies.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupMembershipsService } from './group-memberships.service';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermissionService } from './permissions/group-permission.service';
import { RoleAssignmentsController } from './role-assignments.controller';
import { RoleAssignmentsService } from './role-assignments.service';
import { SectionsController } from './sections.controller';
import { SectionsService } from './sections.service';

// Entities are driven through the plain EntityManager (auto-discovered
// globally), so no forFeature() is needed. Group-level authorization is a
// self-contained system (GroupPermission/GroupRole), deliberately not
// wired to auth/permissions/permissions.module.ts - see
// group-role-permissions.map.ts.
@Module({
  controllers: [
    GroupsController,
    AcademiesController,
    SectionsController,
    RoleAssignmentsController,
  ],
  providers: [
    GroupsService,
    GroupHierarchyService,
    GroupMembershipsService,
    AcademiesService,
    SectionsService,
    GroupPermissionService,
    GroupPermissionsGuard,
    RoleAssignmentsService,
  ],
})
export class GroupsModule {}
