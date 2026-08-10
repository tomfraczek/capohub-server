import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { User } from '../users/entities/user.entity';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { NotificationListResponseDto } from './dto/notification-list-response.dto';
import { NotificationListQueryInput } from './dto/notification-list-query.schema';
import {
  Notification,
  NOTIFICATIONS_DEDUPLICATION_KEY_UNIQUE_INDEX,
} from './entities/notification.entity';
import { NotificationCategory } from './enums/notification-category.enum';
import { NotificationTargetType } from './enums/notification-target-type.enum';
import { NotificationType } from './enums/notification-type.enum';
import { toNotificationResponseDto } from './mappers/notification.mapper';
import { NotificationPushService } from './notification-push.service';

export interface CreateNotificationParams {
  recipient: User;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body: string;
  targetType?: NotificationTargetType | null;
  targetId?: string | null;
  contextGroup?: Group | null;
  contextSection?: Section | null;
  actor?: User | null;
  // Set only by the reminder scheduler - see notification.entity.ts.
  deduplicationKey?: string | null;
}

// The single write/read surface for the central inbox (module spec section
// 19). Every domain integration (Trainings, Events, Announcements,
// Membership, Formal Rank Correction) goes through create()/createMany()
// here rather than writing its own notification table - see this module's
// final report for what replaced TrainingNotification/
// FormalRankCorrectionNotification.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly notificationPushService: NotificationPushService,
  ) {}

  async create(
    em: EntityManager,
    params: CreateNotificationParams,
  ): Promise<Notification | null> {
    const created = await this.createMany(em, [params]);
    return created[0] ?? null;
  }

  /**
   * Persists one row per params entry, then fires push delivery for
   * whatever was actually created - fire-and-forget, never awaited by the
   * caller (module spec section 18: "Nie wykonuj zewnętrznego HTTP Expo
   * call wewnątrz długiej transakcji DB"). This codebase has no outbox/
   * queue table, so this is the "simple, safe boundary" the module spec
   * explicitly allows in that case: the push call is never awaited, so it
   * can never delay or roll back the caller's own transaction, and any
   * error it throws is caught here and only logged, never propagated. The
   * trade-off - the HTTP call may start executing a moment before the
   * enclosing transaction actually commits, since nothing here waits for
   * that commit either - is deliberate and documented rather than solved
   * with a full outbox/event-bus, which the module spec explicitly says
   * not to build for this.
   *
   * Persists one at a time, not as a single batch flush, specifically so a
   * `deduplicationKey` collision (module spec section 27 - the reminder
   * scheduler running twice, possibly concurrently) only ever discards the
   * one colliding row rather than failing the whole batch; every other
   * params entry in the same call still succeeds. Never relies on a
   * SELECT-before-INSERT to avoid the race - the unique index is the real
   * guard (module spec section 38), this is only how the resulting
   * exception is handled gracefully.
   */
  async createMany(
    em: EntityManager,
    paramsList: CreateNotificationParams[],
  ): Promise<Notification[]> {
    const created: Notification[] = [];
    for (const params of paramsList) {
      const notification = new Notification();
      notification.recipient = params.recipient;
      notification.category = params.category;
      notification.type = params.type;
      notification.title = params.title;
      notification.body = params.body;
      notification.targetType = params.targetType ?? null;
      notification.targetId = params.targetId ?? null;
      notification.contextGroup = params.contextGroup ?? null;
      notification.contextSection = params.contextSection ?? null;
      notification.actor = params.actor ?? null;
      notification.deduplicationKey = params.deduplicationKey ?? null;

      em.persist(notification);
      try {
        await em.flush();
        created.push(notification);
      } catch (error) {
        em.remove(notification);
        if (
          params.deduplicationKey &&
          isUniqueViolationOn(
            error,
            NOTIFICATIONS_DEDUPLICATION_KEY_UNIQUE_INDEX,
          )
        ) {
          // Already created by an earlier/concurrent run - not an error,
          // see this method's own comment.
          continue;
        }
        throw error;
      }
    }

    if (created.length > 0) {
      this.notificationPushService
        .deliverMany(created)
        .catch((error: unknown) => {
          this.logger.error('Push delivery failed', error as Error);
        });
    }

    return created;
  }

  async listForUser(
    user: User,
    query: NotificationListQueryInput,
  ): Promise<NotificationListResponseDto> {
    const where: Record<string, unknown> = { recipient: user.id };
    if (query.unreadOnly) {
      where.readAt = null;
    }
    if (query.category) {
      where.category = query.category;
    }

    const em = this.em;
    const [items, total] = await em.findAndCount(Notification, where, {
      populate: ['contextGroup', 'contextSection'],
      orderBy: { createdAt: 'desc', id: 'desc' },
      limit: query.limit,
      offset: query.offset,
    });

    return {
      items: items.map(toNotificationResponseDto),
      total,
      hasMore: query.offset + items.length < total,
    };
  }

  async getUnreadCount(user: User): Promise<number> {
    return this.em.count(Notification, {
      recipient: user.id,
      readAt: null,
    });
  }

  /** Idempotent - marking an already-read Notification read again is a no-op. */
  async markRead(user: User, notificationId: string): Promise<void> {
    const em = this.em;
    const notification = await em.findOne(Notification, {
      id: notificationId,
      recipient: user.id,
    });
    if (!notification) {
      // Never confirms existence of another user's Notification (module
      // spec section 40 - IDOR-safe).
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }
    if (notification.readAt === null) {
      notification.readAt = new Date();
      await em.flush();
    }
  }

  /** Idempotent - a second call finds nothing left to mark and no-ops. */
  async markAllRead(user: User): Promise<void> {
    const em = this.em;
    await em.nativeUpdate(
      Notification,
      { recipient: user.id, readAt: null },
      { readAt: new Date() },
    );
  }
}
