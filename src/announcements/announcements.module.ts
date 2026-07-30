import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { NullPushNotificationService } from './integration/null-push-notification.service';
import { PUSH_NOTIFICATION_PORT } from './integration/push-notification.port';

// Imports GroupsModule for GroupPermissionsGuard (route authorization) and
// to reuse RoleAssignmentsService/RecipientGroupsService rather than
// duplicating community-membership or Recipient-Group-snapshot logic here.
// One-directional: GroupsModule never imports this module back.
@Module({
  imports: [GroupsModule],
  controllers: [AnnouncementsController],
  providers: [
    AnnouncementsService,
    // Placeholder binding until a real push provider exists - see
    // push-notification.port.ts (mirrors EventsModule's own
    // CHILDREN_DIRECTORY_PORT/NullChildrenDirectoryService convention).
    {
      provide: PUSH_NOTIFICATION_PORT,
      useClass: NullPushNotificationService,
    },
  ],
  // Exported for HomeModule - HomeService aggregates the announcements
  // section of GET /home by calling AnnouncementsService.listForViewer
  // directly, reusing the exact same visibility/sorting rule the community-
  // scoped list endpoint uses, rather than re-implementing it in HomeService
  // (task requirement).
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
