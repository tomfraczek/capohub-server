import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnnouncementsController } from './announcements.controller';
import { GlobalAnnouncementsController } from './global-announcements.controller';
import { AnnouncementsService } from './announcements.service';

// Imports GroupsModule for GroupPermissionsGuard (route authorization) and
// to reuse RoleAssignmentsService/RecipientGroupsService/GroupPermissionService
// rather than duplicating community-membership, Recipient-Group-snapshot,
// or archive-permission logic here. One-directional: GroupsModule never
// imports this module back. Imports NotificationsModule so publishing an
// Announcement raises a central Notification for its resolved audience
// (see AnnouncementsService.create) - the placeholder push checkbox this
// comment used to describe is gone now that a real Notifications module
// exists to back it.
@Module({
  imports: [GroupsModule, NotificationsModule],
  controllers: [AnnouncementsController, GlobalAnnouncementsController],
  providers: [AnnouncementsService],
  // Exported for HomeModule - HomeService aggregates the announcements
  // section of GET /home by calling AnnouncementsService.listForViewer
  // directly, reusing the exact same visibility/sorting rule the community-
  // scoped list endpoint uses, rather than re-implementing it in HomeService
  // (task requirement).
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
