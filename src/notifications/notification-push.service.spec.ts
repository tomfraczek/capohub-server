import type { EntityManager } from '@mikro-orm/postgresql';
import { CommunityNotificationSettings } from '../groups/entities/community-notification-settings.entity';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { User } from '../users/entities/user.entity';
import { ExpoPushTicket, ExpoPushTransport } from './expo-push.transport';
import { Notification } from './entities/notification.entity';
import { PushDevice } from './entities/push-device.entity';
import { UserNotificationPreferences } from './entities/user-notification-preferences.entity';
import { NotificationCategory } from './enums/notification-category.enum';
import { NotificationTargetType } from './enums/notification-target-type.enum';
import { NotificationType } from './enums/notification-type.enum';
import { PushPlatform } from './enums/push-platform.enum';
import {
  buildPushData,
  NotificationPushService,
} from './notification-push.service';

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

function buildGroup(id: string): Group {
  const group = new Group();
  group.id = id;
  return group;
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
  settings.communitySection =
    overrides.communityGroup || overrides.communitySection
      ? (overrides.communitySection ?? null)
      : buildSection('section-1');
  settings.communityGroup = overrides.communityGroup ?? null;
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
      settings: [buildSettings({ communitySection: section, muted: true })],
    });
    const { transport, send } = buildTransport();
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification({ contextSection: section })]);

    expect(send).not.toHaveBeenCalled();
  });

  it('suppresses push for a muted Group context, inbox row still exists', async () => {
    const group = buildGroup('group-1');
    const { em } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [buildDevice()],
      settings: [buildSettings({ communityGroup: group, muted: true })],
    });
    const { transport, send } = buildTransport();
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification({ contextGroup: group })]);

    expect(send).not.toHaveBeenCalled();
  });

  it('a muted Group never suppresses an unrelated Section context Notification - exact-resource only, no inheritance', async () => {
    const group = buildGroup('group-1');
    const section = buildSection('section-1');
    const { em } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [buildDevice()],
      settings: [buildSettings({ communityGroup: group, muted: true })],
    });
    const { transport, send } = buildTransport([{ status: 'ok' }]);
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([buildNotification({ contextSection: section })]);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('suppresses push for a fine-grained membership toggle that is off', async () => {
    const section = buildSection('section-1');
    const { em } = buildMockEm({
      preferences: [buildPreferences({ pushMembership: true })],
      devices: [buildDevice()],
      settings: [
        buildSettings({
          communitySection: section,
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

describe('buildPushData', () => {
  it('includes type alongside contextSectionId (and null contextGroupId) for a Section-context Notification', () => {
    const section = buildSection('section-1');
    const data = buildPushData(
      buildNotification({
        type: NotificationType.TRAINING_CANCELLED,
        targetType: NotificationTargetType.TRAINING,
        targetId: 'training-1',
        contextSection: section,
        contextGroup: null,
      }),
    );

    expect(data).toEqual({
      notificationId: 'notif-1',
      type: NotificationType.TRAINING_CANCELLED,
      targetType: NotificationTargetType.TRAINING,
      targetId: 'training-1',
      contextGroupId: null,
      contextSectionId: 'section-1',
    });
  });

  it('includes type alongside contextGroupId (and null contextSectionId) for a Group-context Notification', () => {
    const group = buildGroup('group-1');
    const data = buildPushData(
      buildNotification({
        type: NotificationType.HIERARCHY_INVITATION_RECEIVED,
        targetType: NotificationTargetType.HIERARCHY_INVITATION,
        targetId: 'invitation-1',
        contextGroup: group,
        contextSection: null,
      }),
    );

    expect(data).toEqual({
      notificationId: 'notif-1',
      type: NotificationType.HIERARCHY_INVITATION_RECEIVED,
      targetType: NotificationTargetType.HIERARCHY_INVITATION,
      targetId: 'invitation-1',
      contextGroupId: 'group-1',
      contextSectionId: null,
    });
  });

  it('both context ids are null when the Notification carries neither', () => {
    const data = buildPushData(
      buildNotification({
        targetType: NotificationTargetType.USER,
        targetId: 'user-9',
        contextGroup: null,
        contextSection: null,
      }),
    );

    expect(data.contextGroupId).toBeNull();
    expect(data.contextSectionId).toBeNull();
  });

  it('MEMBERSHIP_REQUEST: type + exact Section context alongside the request id', () => {
    const section = buildSection('section-1');
    const data = buildPushData(
      buildNotification({
        type: NotificationType.SECTION_JOIN_REQUEST_RECEIVED,
        targetType: NotificationTargetType.MEMBERSHIP_REQUEST,
        targetId: 'request-1',
        contextSection: section,
        contextGroup: null,
      }),
    );

    expect(data).toMatchObject({
      type: NotificationType.SECTION_JOIN_REQUEST_RECEIVED,
      targetType: NotificationTargetType.MEMBERSHIP_REQUEST,
      targetId: 'request-1',
      contextSectionId: 'section-1',
      contextGroupId: null,
    });
  });

  it('HIERARCHY_INVITATION: type + exact target community context alongside the invitation id', () => {
    const group = buildGroup('group-1');
    const data = buildPushData(
      buildNotification({
        type: NotificationType.HIERARCHY_INVITATION_ACCEPTED,
        targetType: NotificationTargetType.HIERARCHY_INVITATION,
        targetId: 'invitation-1',
        contextGroup: group,
        contextSection: null,
      }),
    );

    expect(data).toMatchObject({
      type: NotificationType.HIERARCHY_INVITATION_ACCEPTED,
      targetType: NotificationTargetType.HIERARCHY_INVITATION,
      targetId: 'invitation-1',
      contextGroupId: 'group-1',
      contextSectionId: null,
    });
  });

  it('TRAINING: type + exact Section context alongside the training id', () => {
    const section = buildSection('section-1');
    const data = buildPushData(
      buildNotification({
        type: NotificationType.TRAINING_TIME_CHANGED,
        targetType: NotificationTargetType.TRAINING,
        targetId: 'training-1',
        contextSection: section,
        contextGroup: null,
      }),
    );

    expect(data).toMatchObject({
      type: NotificationType.TRAINING_TIME_CHANGED,
      targetType: NotificationTargetType.TRAINING,
      targetId: 'training-1',
      contextSectionId: 'section-1',
      contextGroupId: null,
    });
  });

  it('EVENT: type + context still resolve correctly (Event may be Group- or Section-scoped)', () => {
    const group = buildGroup('group-1');
    const data = buildPushData(
      buildNotification({
        category: NotificationCategory.EVENT,
        type: NotificationType.EVENT_CANCELLED,
        targetType: NotificationTargetType.EVENT,
        targetId: 'event-1',
        contextGroup: group,
        contextSection: null,
      }),
    );

    expect(data).toEqual({
      notificationId: 'notif-1',
      type: NotificationType.EVENT_CANCELLED,
      targetType: NotificationTargetType.EVENT,
      targetId: 'event-1',
      contextGroupId: 'group-1',
      contextSectionId: null,
    });
  });

  describe('FORMAL_RANK_CORRECTION - type disambiguates reviewer flow from self-service flow, targetType alone cannot', () => {
    const section = buildSection('section-1');

    it('SUBMITTED carries the exact type the reviewer/admin flow must key off', () => {
      const data = buildPushData(
        buildNotification({
          type: NotificationType.FORMAL_RANK_CORRECTION_SUBMITTED,
          targetType: NotificationTargetType.FORMAL_RANK_CORRECTION,
          targetId: 'correction-1',
          contextSection: section,
          contextGroup: null,
        }),
      );

      expect(data).toMatchObject({
        type: NotificationType.FORMAL_RANK_CORRECTION_SUBMITTED,
        targetType: NotificationTargetType.FORMAL_RANK_CORRECTION,
        targetId: 'correction-1',
        contextSectionId: 'section-1',
        contextGroupId: null,
      });
    });

    it.each([
      NotificationType.FORMAL_RANK_CORRECTION_REQUIRED,
      NotificationType.FORMAL_RANK_CORRECTION_APPROVED,
      NotificationType.FORMAL_RANK_CORRECTION_REJECTED,
    ])(
      '%s keeps its own type, distinct from SUBMITTED, even though targetType is identical',
      (type) => {
        const data = buildPushData(
          buildNotification({
            type,
            targetType: NotificationTargetType.FORMAL_RANK_CORRECTION,
            targetId: 'correction-1',
            contextSection: section,
            contextGroup: null,
          }),
        );

        expect(data.type).toBe(type);
        expect(data.type).not.toBe(
          NotificationType.FORMAL_RANK_CORRECTION_SUBMITTED,
        );
        expect(data.targetType).toBe(
          NotificationTargetType.FORMAL_RANK_CORRECTION,
        );
      },
    );
  });
});

describe('NotificationPushService.deliverMany - push data on the outgoing message', () => {
  it('attaches the exact buildPushData shape as the message data, including type', async () => {
    const section = buildSection('section-1');
    const notification = buildNotification({
      type: NotificationType.TRAINING_CANCELLED,
      targetType: NotificationTargetType.TRAINING,
      targetId: 'training-1',
      contextSection: section,
      contextGroup: null,
    });
    const { em } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [buildDevice()],
    });
    const { transport, send } = buildTransport([{ status: 'ok' }]);
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([notification]);

    const [messages] = send.mock.calls[0] as [
      { data?: Record<string, unknown> }[],
    ];
    expect(messages[0].data).toEqual({
      notificationId: 'notif-1',
      type: NotificationType.TRAINING_CANCELLED,
      targetType: NotificationTargetType.TRAINING,
      targetId: 'training-1',
      contextGroupId: null,
      contextSectionId: 'section-1',
    });
  });

  it('attaches FORMAL_RANK_CORRECTION_SUBMITTED type distinctly on the outgoing message', async () => {
    const section = buildSection('section-1');
    const notification = buildNotification({
      type: NotificationType.FORMAL_RANK_CORRECTION_SUBMITTED,
      targetType: NotificationTargetType.FORMAL_RANK_CORRECTION,
      targetId: 'correction-1',
      contextSection: section,
      contextGroup: null,
    });
    const { em } = buildMockEm({
      preferences: [buildPreferences()],
      devices: [buildDevice()],
    });
    const { transport, send } = buildTransport([{ status: 'ok' }]);
    const service = new NotificationPushService(em, transport);

    await service.deliverMany([notification]);

    const [messages] = send.mock.calls[0] as [
      { data?: Record<string, unknown> }[],
    ];
    expect(messages[0].data?.type).toBe(
      NotificationType.FORMAL_RANK_CORRECTION_SUBMITTED,
    );
  });
});
