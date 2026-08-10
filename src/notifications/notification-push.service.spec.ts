import type { EntityManager } from '@mikro-orm/postgresql';
import { CommunityNotificationSettings } from '../groups/entities/community-notification-settings.entity';
import { Section } from '../groups/entities/section.entity';
import { User } from '../users/entities/user.entity';
import { ExpoPushTicket, ExpoPushTransport } from './expo-push.transport';
import { Notification } from './entities/notification.entity';
import { PushDevice } from './entities/push-device.entity';
import { UserNotificationPreferences } from './entities/user-notification-preferences.entity';
import { NotificationCategory } from './enums/notification-category.enum';
import { NotificationType } from './enums/notification-type.enum';
import { PushPlatform } from './enums/push-platform.enum';
import { NotificationPushService } from './notification-push.service';

function buildUser(id: string): User {
  const user = new User();
  user.id = id;
  return user;
}

function buildSection(id: string): Section {
  const section = new Section();
  section.id = id;
  return section;
}

function buildNotification(
  overrides: Partial<Notification> = {},
): Notification {
  const notification = new Notification();
  notification.id = overrides.id ?? 'notif-1';
  notification.recipient = overrides.recipient ?? buildUser('user-1');
  notification.category = overrides.category ?? NotificationCategory.TRAINING;
  notification.type = overrides.type ?? NotificationType.TRAINING_CANCELLED;
  notification.title = 'Trening odwołany';
  notification.body = 'Trening odwołany.';
  notification.targetType = null;
  notification.targetId = null;
  notification.contextSection = overrides.contextSection ?? null;
  notification.contextGroup = null;
  return Object.assign(notification, overrides);
}

function buildDevice(overrides: Partial<PushDevice> = {}): PushDevice {
  const device = new PushDevice();
  device.id = overrides.id ?? 'device-1';
  device.user = overrides.user ?? buildUser('user-1');
  device.expoPushToken = overrides.expoPushToken ?? 'ExponentPushToken[abc]';
  device.platform = PushPlatform.IOS;
  device.isActive = true;
  return Object.assign(device, overrides);
}

function buildPreferences(
  overrides: Partial<UserNotificationPreferences> = {},
): UserNotificationPreferences {
  const preferences = new UserNotificationPreferences();
  preferences.user = overrides.user ?? buildUser('user-1');
  preferences.pushEnabled = true;
  preferences.pushTraining = true;
  return Object.assign(preferences, overrides);
}

function buildSettings(
  overrides: Partial<CommunityNotificationSettings> = {},
): CommunityNotificationSettings {
  const settings = new CommunityNotificationSettings();
  settings.user = overrides.user ?? buildUser('user-1');
  settings.community = overrides.community ?? buildSection('section-1');
  settings.muted = false;
  return Object.assign(settings, overrides);
}

interface Routing {
  preferences?: UserNotificationPreferences[];
  devices?: PushDevice[];
  settings?: CommunityNotificationSettings[];
}

function buildMockEm(routing: Routing = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const find = jest.fn((entity: unknown) => {
    if (entity === UserNotificationPreferences) {
      return Promise.resolve(routing.preferences ?? []);
    }
    if (entity === PushDevice) {
      return Promise.resolve(routing.devices ?? []);
    }
    if (entity === CommunityNotificationSettings) {
      return Promise.resolve(routing.settings ?? []);
    }
    return Promise.resolve([]);
  });
  const raw: Record<string, unknown> = { find, flush };
  raw.fork = jest.fn(() => raw);
  return { em: raw as unknown as EntityManager, find, flush };
}

function buildTransport(tickets: ExpoPushTicket[] = []): {
  transport: ExpoPushTransport;
  send: jest.Mock;
} {
  const send = jest.fn().mockResolvedValue(tickets);
  return { transport: { send } as unknown as ExpoPushTransport, send };
}

describe('NotificationPushService.deliverMany', () => {
  it('sends nothing when the recipient has no active device', async () => {
    const { em } = buildMockEm({ devices: [] });
    const { transport, send } = buildTransport();
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification()]);

    expect(send).not.toHaveBeenCalled();
  });

  it('suppresses push when the master pushEnabled switch is off, inbox row untouched', async () => {
    const { em } = buildMockEm({
      preferences: [buildPreferences({ pushEnabled: false })],
      devices: [buildDevice()],
    });
    const { transport, send } = buildTransport();
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification()]);

    expect(send).not.toHaveBeenCalled();
  });

  it('suppresses push when the category preference is off', async () => {
    const { em } = buildMockEm({
      preferences: [buildPreferences({ pushTraining: false })],
      devices: [buildDevice()],
    });
    const { transport, send } = buildTransport();
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([
      buildNotification({ category: NotificationCategory.TRAINING }),
    ]);

    expect(send).not.toHaveBeenCalled();
  });

  it('sends when every preference is on and a device is active', async () => {
    const { em } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [buildDevice()],
    });
    const { transport, send } = buildTransport([
      { status: 'ok', id: 'ticket-1' },
    ]);
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification()]);

    expect(send).toHaveBeenCalledTimes(1);
    const [messages] = send.mock.calls[0] as [{ to: string }[]];
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe('ExponentPushToken[abc]');
  });

  it('suppresses push for a muted Section context, inbox row still exists', async () => {
    const section = buildSection('section-1');
    const { em } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [buildDevice()],
      settings: [buildSettings({ community: section, muted: true })],
    });
    const { transport, send } = buildTransport();
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification({ contextSection: section })]);

    expect(send).not.toHaveBeenCalled();
  });

  it('suppresses push for a fine-grained membership toggle that is off', async () => {
    const section = buildSection('section-1');
    const { em } = buildMockEm({
      preferences: [buildPreferences({ pushMembership: true })],
      devices: [buildDevice()],
      settings: [
        buildSettings({
          community: section,
          muted: false,
          newJoinRequests: false,
        }),
      ],
    });
    const { transport, send } = buildTransport();
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([
      buildNotification({
        category: NotificationCategory.MEMBERSHIP,
        type: NotificationType.SECTION_JOIN_REQUEST_RECEIVED,
        contextSection: section,
      }),
    ]);

    expect(send).not.toHaveBeenCalled();
  });

  it('an important Announcement bypasses the pushCommunity category toggle', async () => {
    const { em } = buildMockEm({
      preferences: [buildPreferences({ pushCommunity: false })],
      devices: [buildDevice()],
    });
    const { transport, send } = buildTransport([{ status: 'ok' }]);
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([
      buildNotification({
        category: NotificationCategory.COMMUNITY,
        type: NotificationType.IMPORTANT_ANNOUNCEMENT_PUBLISHED,
      }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('deactivates a device on DeviceNotRegistered, never on a transient error', async () => {
    const deviceA = buildDevice({ id: 'device-a', expoPushToken: 'token-a' });
    const deviceB = buildDevice({ id: 'device-b', expoPushToken: 'token-b' });
    const { em, flush } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [deviceA, deviceB],
    });
    const { transport } = buildTransport([
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]);
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification()]);

    expect(deviceA.isActive).toBe(false);
    expect(deviceB.isActive).toBe(true);
    expect(flush).toHaveBeenCalled();
  });

  it('never deactivates any device when the whole Expo request fails', async () => {
    const device = buildDevice();
    const { em, flush } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [device],
    });
    const send = jest.fn().mockRejectedValue(new Error('network down'));
    const transport = { send } as unknown as ExpoPushTransport;
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification()]);

    expect(device.isActive).toBe(true);
    expect(flush).not.toHaveBeenCalled();
  });
});
