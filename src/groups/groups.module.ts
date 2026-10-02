import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AcademiesController } from './academies.controller';
import { AcademiesService } from './academies.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { CohortsController } from './cohorts.controller';
import { CohortsService } from './cohorts.service';
import { CommunityHomeController } from './community-home.controller';
import { CommunityHomeService } from './community-home.service';
import { CommunityOverviewController } from './community-overview.controller';
import { CommunityOverviewService } from './community-overview.service';
import { CommunityNotificationSettingsController } from './community-notification-settings.controller';
import { CommunityNotificationSettingsService } from './community-notification-settings.service';
import { GroupAudienceService } from './group-audience.service';
import { GroupFollowService } from './group-follow.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupNotificationSettingsController } from './group-notification-settings.controller';
import { HierarchyInvitationsController } from './hierarchy-invitations.controller';
import { HierarchyManagementService } from './hierarchy-management.service';
import { SectionMembershipsService } from './section-memberships.service';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermissionService } from './permissions/group-permission.service';
import { InvitationsController } from './invitations.controller';
import { MembershipRequestsController } from './membership-requests.controller';
import { MembershipRequestsService } from './membership-requests.service';
import { RecipientGroupsController } from './recipient-groups.controller';
import { RecipientGroupsService } from './recipient-groups.service';
import { RoleAssignmentsController } from './role-assignments.controller';
import { RoleAssignmentsService } from './role-assignments.service';
import { SectionController } from './section.controller';
import { SectionsController } from './sections.controller';
import { SectionsService } from './sections.service';
import { StandaloneSectionsController } from './standalone-sections.controller';

// Entities are driven through the plain EntityManager (auto-discovered
// globally), so no forFeature() is needed. Group-level authorization is a
// self-contained system (GroupPermission/GroupRole), deliberately not
// wired to auth/permissions/permissions.module.ts - see
// group-role-permissions.map.ts.
@Module({
  // StorageModule is imported for the Group/Section profile-image
  // upload/delete endpoints (see GroupsService.uploadProfileImage/
  // SectionsService.uploadProfileImage) and for resolving logoUrl in every
  // Group/Section response DTO (see mappers/group.mapper.ts,
  // mappers/section.mapper.ts).
  imports: [NotificationsModule, StorageModule],
  controllers: [
    GroupsController,
    SectionsController,
    SectionController,
    StandaloneSectionsController,
    AcademiesController,
    CohortsController,
    RoleAssignmentsController,
    MembershipRequestsController,
    InvitationsController,
    CommunityHomeController,
    CommunityOverviewController,
    AuditLogController,
    CommunityNotificationSettingsController,
    GroupNotificationSettingsController,
    RecipientGroupsController,
    HierarchyInvitationsController,
  ],
  providers: [
    GroupsService,
    SectionsService,
    GroupHierarchyService,
    HierarchyManagementService,
    SectionMembershipsService,
    AcademiesService,
    CohortsService,
    GroupPermissionService,
    GroupPermissionsGuard,
    RoleAssignmentsService,
    MembershipRequestsService,
    CommunityHomeService,
    AuditLogService,
    CommunityNotificationSettingsService,
    RecipientGroupsService,
    GroupFollowService,
    GroupAudienceService,
    CommunityOverviewService,
  ],
  // RoleAssignmentsService is exported for UsersModule - DELETE /users/me
  // must not hard-delete a User who still owns a Group (see
  // UserService.assertOwnsNoGroups). GroupPermissionService,
  // GroupHierarchyService and GroupPermissionsGuard are additionally
  // exported for EventsModule - resolving a caller's Community-level
  // Role/permissions (for the GroupPermission.EVENT_CREATE gate on
  // POST .../events and the EVENT_MODERATE oversight override - see
  // events/guards/event-permissions.guard.ts) reuses this exact machinery
  // rather than duplicating it. RecipientGroupsService is additionally
  // exported for AnnouncementsModule - resolving/snapshotting a Recipient
  // Group's members at publish time reuses this exact service rather than
  // AnnouncementsService re-querying RecipientGroupMember itself.
  // One-directional: GroupsModule never imports UsersModule, EventsModule,
  // or AnnouncementsModule back.
  // AuditLogService is additionally exported for GraduationModule - logging
  // graduation catalog mutations (system/rank create/edit/reorder/archive/
  // restore) under the exact owning Group reuses this exact service rather
  // than GraduationModule re-implementing AuditLogEntry writes itself.
  exports: [
    RoleAssignmentsService,
    GroupPermissionService,
    GroupHierarchyService,
    GroupPermissionsGuard,
    RecipientGroupsService,
    AuditLogService,
    // GroupFollowService is additionally exported for EventsModule - a
    // PUBLIC Group Event's notification audience includes the Group's
    // followers (see EventNotificationsService's own comment) and reuses
    // this exact service rather than EventsModule re-querying GroupFollow
    // itself.
    GroupFollowService,
  ],
})
export class GroupsModule {}
