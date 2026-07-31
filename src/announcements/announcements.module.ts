import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

// Imports GroupsModule for GroupPermissionsGuard (route authorization) and
// to reuse RoleAssignmentsService/RecipientGroupsService/GroupPermissionService
// rather than duplicating community-membership, Recipient-Group-snapshot,
// or archive-permission logic here. One-directional: GroupsModule never
// imports this module back.
//
// No push-notification wiring here - a `sendPushNotification` checkbox
// existed briefly, backed only by a placeholder port whose sole
// implementation always reported 0 delivered. Since this codebase has no
// device-token storage, no registration flow, and no provider SDK, that
// checkbox was removed from the public API entirely rather than kept as a
// button that looks functional but never delivers anything (see
// AnnouncementsService's git history / the "Push" section of this
// engagement's reports). Push will return once a real Notifications module
// exists to back it.
@Module({
  imports: [GroupsModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  // Exported for HomeModule - HomeService aggregates the announcements
  // section of GET /home by calling AnnouncementsService.listForViewer
  // directly, reusing the exact same visibility/sorting rule the community-
  // scoped list endpoint uses, rather than re-implementing it in HomeService
  // (task requirement).
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
