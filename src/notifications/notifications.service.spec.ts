import { NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import { NotificationCategory } from './enums/notification-category.enum';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationPushService } from './notification-push.service';
import {
  CreateNotificationParams,
  NotificationsService,
} from './notifications.service';

function buildUser(id: string): User {
  const user = new User();
  user.id = id;
  user.displayName = `User ${id}`;
  return user;
}

function buildParams(
  overrides: Partial<CreateNotificationParams> = {},
): CreateNotificationParams {
  return {
    recipient: buildUser('user-1'),
    category: NotificationCategory.TRAINING,
    type: NotificationType.TRAINING_CANCELLED,
    title: 'Trening odwołany',
    body: 'Trening odwołany.',
    ...overrides,
  };
}

interface MockRouting {
  flushError?: unknown;
  findAndCountResult?: [Notification[], number];
  countResult?: number;
  findOneResult?: Notification | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const persisted: Notification[] = [];
  const removed: Notification[] = [];
  const persist = jest.fn((entity: Notification) => persisted.push(entity));
  const remove = jest.fn((entity: Notification) => removed.push(entity));
  const flush = routing.flushError
    ? jest.fn().mockRejectedValue(routing.flushError)
    : jest.fn().mockResolvedValue(undefined);
  const findAndCount = jest
    .fn()
    .mockResolvedValue(routing.findAndCountResult ?? [[], 0]);
  const count = jest.fn().mockResolvedValue(routing.countResult ?? 0);
  const findOne = jest.fn().mockResolvedValue(routing.findOneResult ?? null);
  const nativeUpdate = jest.fn().mockResolvedValue(0);

  const raw = {
    persist,
    remove,
    flush,
    findAndCount,
    count,
    findOne,
    nativeUpdate,
  };

  return {
    em: raw as unknown as EntityManager,
    persist,
    remove,
    flush,
    findAndCount,
    count,
    findOne,
    nativeUpdate,
    persisted,
    removed,
  };
}

function buildPushService(): {
  pushService: NotificationPushService;
  deliverMany: jest.Mock;
} {
  const deliverMany = jest.fn().mockResolvedValue(undefined);
  return {
    pushService: { deliverMany } as unknown as NotificationPushService,
    deliverMany,
  };
}

describe('NotificationsService.createMany', () => {
  it('persists one row per recipient and triggers push delivery', async () => {
    const { em, persisted } = buildMockEm();
    const { pushService, deliverMany } = buildPushService();
    const service = new NotificationsService(em, pushService);

    const created = await service.createMany(em, [
      buildParams({ recipient: buildUser('a') }),
      buildParams({ recipient: buildUser('b') }),
    ]);

    expect(created).toHaveLength(2);
    expect(persisted).toHaveLength(2);
    expect(deliverMany).toHaveBeenCalledWith(created);
  });

  it('never awaits push delivery - a rejected delivery is caught, not thrown', async () => {
    const { em } = buildMockEm();
    const deliverMany = jest.fn().mockRejectedValue(new Error('expo down'));
    const pushService = { deliverMany } as unknown as NotificationPushService;
    const service = new NotificationsService(em, pushService);

    await expect(service.createMany(em, [buildParams()])).resolves.toHaveLength(
      1,
    );
  });

  it('gracefully skips a deduplicationKey collision instead of throwing', async () => {
    const { em, remove } = buildMockEm();
    let call = 0;
    (em.flush as jest.Mock).mockImplementation(() => {
      call += 1;
      if (call === 2) {
        return Promise.reject(
          new UniqueConstraintViolationException(
            new Error('notifications_deduplication_key_unique'),
          ),
        );
      }
      return Promise.resolve(undefined);
    });
    const { pushService } = buildPushService();
    const service = new NotificationsService(em, pushService);

    const created = await service.createMany(em, [
      buildParams({ deduplicationKey: 'key-1' }),
      buildParams({ deduplicationKey: 'key-2' }),
      buildParams({ deduplicationKey: 'key-3' }),
    ]);

    // Only the second item's flush rejected - the other two still succeed,
    // and the colliding one is detached rather than aborting the batch.
    expect(created).toHaveLength(2);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('rethrows a flush error unrelated to deduplication', async () => {
    const boom = new Error('connection lost');
    const { em } = buildMockEm({ flushError: boom });
    const { pushService } = buildPushService();
    const service = new NotificationsService(em, pushService);

    await expect(
      service.createMany(em, [buildParams({ deduplicationKey: 'key-1' })]),
    ).rejects.toThrow(boom);
  });

  it('returns [] and never calls push delivery for an empty input', async () => {
    const { em } = buildMockEm();
    const { pushService, deliverMany } = buildPushService();
    const service = new NotificationsService(em, pushService);

    const created = await service.createMany(em, []);

    expect(created).toEqual([]);
    expect(deliverMany).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.markRead', () => {
  it('sets readAt exactly once and is idempotent on a second call', async () => {
    const notification = new Notification();
    notification.id = 'n-1';
    notification.readAt = null;
    const { em, flush } = buildMockEm({ findOneResult: notification });
    const { pushService } = buildPushService();
    const service = new NotificationsService(em, pushService);

    await service.markRead(buildUser('user-1'), 'n-1');
    expect(notification.readAt).not.toBeNull();
    expect(flush).toHaveBeenCalledTimes(1);

    // Second call: readAt already set, no further flush.
    await service.markRead(buildUser('user-1'), 'n-1');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('404s (IDOR-safe) when the notification does not belong to this user', async () => {
    const { em } = buildMockEm({ findOneResult: null });
    const { pushService } = buildPushService();
    const service = new NotificationsService(em, pushService);

    await expect(
      service.markRead(buildUser('user-1'), 'not-mine'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('NotificationsService.markAllRead', () => {
  it('bulk-updates every unread row for this user only', async () => {
    const { em, nativeUpdate } = buildMockEm();
    const { pushService } = buildPushService();
    const service = new NotificationsService(em, pushService);

    await service.markAllRead(buildUser('user-1'));

    expect(nativeUpdate).toHaveBeenCalledWith(
      Notification,
      { recipient: 'user-1', readAt: null },
      { readAt: expect.any(Date) as Date },
    );
  });
});

describe('NotificationsService.listForUser / getUnreadCount', () => {
  it('applies unreadOnly and category filters', async () => {
    const { em, findAndCount } = buildMockEm({ findAndCountResult: [[], 0] });
    const { pushService } = buildPushService();
    const service = new NotificationsService(em, pushService);

    await service.listForUser(buildUser('user-1'), {
      unreadOnly: true,
      category: NotificationCategory.TRAINING,
      limit: 20,
      offset: 0,
    });

    expect(findAndCount).toHaveBeenCalledWith(
      Notification,
      {
        recipient: 'user-1',
        readAt: null,
        category: NotificationCategory.TRAINING,
      },
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it('counts only unread rows for this recipient', async () => {
    const { em, count } = buildMockEm({ countResult: 3 });
    const { pushService } = buildPushService();
    const service = new NotificationsService(em, pushService);

    const result = await service.getUnreadCount(buildUser('user-1'));

    expect(result).toBe(3);
    expect(count).toHaveBeenCalledWith(Notification, {
      recipient: 'user-1',
      readAt: null,
    });
  });
});
