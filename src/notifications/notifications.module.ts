import { Module } from '@nestjs/common';
import { ExpoPushTransport } from './expo-push.transport';
import { NotificationPushService } from './notification-push.service';
import { NotificationReminderScheduler } from './notification-reminder.scheduler';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushDevicesController } from './push-devices.controller';
import { PushDevicesService } from './push-devices.service';
import { UserNotificationPreferencesController } from './user-notification-preferences.controller';
import { UserNotificationPreferencesService } from './user-notification-preferences.service';

// Entities are driven through the plain EntityManager (auto-discovered
// globally), so no forFeature() is needed - same convention as every other
// module in this codebase. Deliberately imports no other domain module
// (Groups/Events/Trainings/Graduation/Announcements): every cross-domain
// fact it needs (CommunityNotificationSettings mute, Group/Section context)
// is read as a plain entity, never through another module's service - so
// every one of those domain modules can import this module back without
// creating a cycle (see e.g. TrainingsModule/EventsModule/GroupsModule).
@Module({
  controllers: [
    NotificationsController,
    UserNotificationPreferencesController,
    PushDevicesController,
  ],
  providers: [
    NotificationsService,
    NotificationPushService,
    ExpoPushTransport,
    UserNotificationPreferencesService,
    PushDevicesService,
    NotificationReminderScheduler,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
