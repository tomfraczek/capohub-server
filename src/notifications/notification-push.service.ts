import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CommunityNotificationSettings } from '../groups/entities/community-notification-settings.entity';
import {
  ExpoPushMessage,
  ExpoPushTransport,
  EXPO_PUSH_MAX_MESSAGES_PER_REQUEST,
} from './expo-push.transport';
import { Notification } from './entities/notification.entity';
import { PushDevice } from './entities/push-device.entity';
import { UserNotificationPreferences } from './entities/user-notification-preferences.entity';
import { NotificationCategory } from './enums/notification-category.enum';
import { NotificationTargetType } from './enums/notification-target-type.enum';
import { NotificationType } from './enums/notification-type.enum';

// The exact `data` payload attached to every push message - deliberately
// the same navigation-relevant fields the inbox itself exposes
// (NotificationResponseDto's type/targetType/targetId/contextGroupId/
// contextSectionId), so a tap on a push notification can navigate exactly
// as precisely as a tap in the inbox (a TRAINING/ANNOUNCEMENT/
// MEMBERSHIP_REQUEST/HIERARCHY_INVITATION/FORMAL_RANK_CORRECTION target
// cannot be routed to without knowing which Group or Section it belongs
// to). `type` is included alongside `targetType` because several
// NotificationTypes share one targetType but need different frontend
// routing - e.g. FORMAL_RANK_CORRECTION_SUBMITTED (reviewer/admin flow)
// vs. FORMAL_RANK_CORRECTION_REQUIRED/APPROVED/REJECTED (self-service
// flow), all four sharing targetType FORMAL_RANK_CORRECTION - so
// targetType alone cannot disambiguate them. Never a full context object,
// never a route/URL, never any other field - see buildPushData's own
// comment.
export interface NotificationPushData {
  notificationId: string;
  type: NotificationType;
  targetType: NotificationTargetType | null;
  targetId: string | null;
  contextGroupId: string | null;
  contextSectionId: string | null;
  // Satisfies ExpoPushMessage.data's `Record<string, unknown>` shape -
  // every concrete field above is still fully typed for callers/tests, this
  // only widens what the *type checker* accepts when assigning into
  // ExpoPushMessage.data, it does not add any actual extra field.
  [key: string]: unknown;
}

// Pulled out as its own small, pure function (rather than built inline in
// deliverMany) purely for testability - a unit test can assert on this
// mapping directly, for every targetType, without needing to also drive
// preferences/devices/mute resolution.
export function buildPushData(
  notification: Notification,
): NotificationPushData {
  return {
    notificationId: notification.id,
    type: notification.type,
    targetType: notification.targetType,
    targetId: notification.targetId,
    contextGroupId: notification.contextGroup?.id ?? null,
    contextSectionId: notification.contextSection?.id ?? null,
  };
}

// Which UserNotificationPreferences boolean field gates push for each
// category - SYSTEM has none: it always passes this check (module spec
// section 10's "bezpieczna reguła" for system push - there is no toggle to
// turn it off, matching the inbox's own "never disable SYSTEM" rule).
const CATEGORY_PREFERENCE_FIELD: Partial<
  Record<NotificationCategory, keyof UserNotificationPreferences>
> = {
  [NotificationCategory.COMMUNITY]: 'pushCommunity',
  [NotificationCategory.TRAINING]: 'pushTraining',
  [NotificationCategory.EVENT]: 'pushEvent',
  [NotificationCategory.MEMBERSHIP]: 'pushMembership',
  [NotificationCategory.GRADUATION]: 'pushGraduation',
  [NotificationCategory.PAYMENT]: 'pushPayment',
};

// Five of CommunityNotificationSettings' ten pre-existing per-Section
// toggles map 1:1 onto a specific membership NotificationType (see that
// entity's own field comments) - checked in addition to (never instead of)
// pushMembership/muted above. The other five (roleChanges,
// transferOwnership, archived, restored, communityDeleted) have no
// corresponding NotificationType, since no domain integration in this
// module raises a notification for those events (module spec: "Nie
// inventuj eventów, których domena jeszcze nie posiada") - they remain
// exactly as before this module, settable but not yet consulted anywhere.
const MEMBERSHIP_TYPE_SETTINGS_FIELD: Partial<
  Record<NotificationType, keyof CommunityNotificationSettings>
> = {
  [NotificationType.SECTION_JOIN_REQUEST_RECEIVED]: 'newJoinRequests',
  [NotificationType.SECTION_JOIN_REQUEST_APPROVED]: 'joinRequestApproved',
  [NotificationType.SECTION_INVITATION_RECEIVED]: 'newInvitations',
  [NotificationType.SECTION_INVITATION_ACCEPTED]: 'invitationAccepted',
  [NotificationType.SECTION_INVITATION_REJECTED]: 'invitationRejected',
};

interface RecipientDeliveryContext {
  preferences: UserNotificationPreferences | null;
  devices: PushDevice[];
  // Keyed by the exact community id (a Group id or a Section id - never
  // both for the same row, see CommunityNotificationSettings' own
  // dual-nullable-FK comment) - every CommunityNotificationSettings row
  // this recipient has, muted or not (module spec: `muted` and the five
  // per-action toggles above are independent checks, both read from the
  // same row).
  communitySettings: Map<string, CommunityNotificationSettings>;
}

// Resolves whichever of communityGroup/communitySection is actually set on
// a CommunityNotificationSettings row - see that entity's own comment.
function communitySettingsCommunityId(
  settings: CommunityNotificationSettings,
): string {
  return (settings.communityGroup ?? settings.communitySection)!.id;
}

/**
 * The single delivery path from a persisted Notification to zero or more
 * Expo push sends (module spec section 15) - never a source of truth
 * itself (module spec section 2): every decision here only ever decides
 * whether/where to *push* an already-created Notification, never whether
 * one exists in the inbox.
 *
 * Order of checks, all of which only ever suppress *push*, never the
 * Notification row itself (module spec section 31):
 *  1. global pushEnabled (UserNotificationPreferences)
 *  2. per-category preference (see CATEGORY_PREFERENCE_FIELD)
 *  3. per-community mute (CommunityNotificationSettings.muted, resolved
 *     against whichever of contextGroup/contextSection the Notification
 *     actually carries - exact-resource only, never inherited) and, for
 *     the five membership NotificationTypes that have one, the matching
 *     fine-grained toggle (see MEMBERSHIP_TYPE_SETTINGS_FIELD) - Section
 *     only, read from the same row
 *  4. at least one active PushDevice
 */
@Injectable()
export class NotificationPushService {
  private readonly logger = new Logger(NotificationPushService.name);

  constructor(
    readonly em: EntityManager,
    private readonly expoPushTransport: ExpoPushTransport,
  ) {}

  async deliverMany(notifications: Notification[]): Promise<void> {
    if (notifications.length === 0) {
      return;
    }

    // A fresh fork, never the caller's own (often already-transactional,
    // often request-scoped) EntityManager: deliverMany is always invoked
    // fire-and-forget, after its caller has already moved on (module spec
    // §18) - by the time this actually runs, the originating request's own
    // EntityManager/transaction may already be committed and torn down, so
    // reusing it here would intermittently fail with a "transaction
    // already complete" driver error instead of just working.
    const em = this.em.fork();

    const recipientIds = [...new Set(notifications.map((n) => n.recipient.id))];
    const contextByRecipient = await this.loadRecipientContexts(
      em,
      recipientIds,
    );

    const messages: ExpoPushMessage[] = [];
    const deviceByTokenIndex: PushDevice[] = [];

    for (const notification of notifications) {
      const context = contextByRecipient.get(notification.recipient.id);
      if (!context || context.devices.length === 0) {
        continue;
      }
      if (!this.isPushAllowed(notification, context)) {
        continue;
      }
      const data = buildPushData(notification);
      for (const device of context.devices) {
        messages.push({
          to: device.expoPushToken,
          title: notification.title,
          body: notification.body,
          data,
        });
        deviceByTokenIndex.push(device);
      }
    }

    if (messages.length === 0) {
      return;
    }

    await this.sendInChunks(em, messages, deviceByTokenIndex);
  }

  private isPushAllowed(
    notification: Notification,
    context: RecipientDeliveryContext,
  ): boolean {
    const preferences = context.preferences;
    if (preferences && !preferences.pushEnabled) {
      return false;
    }

    // An important Announcement pushes by default, bypassing the
    // pushCommunity category toggle (module spec § ANNOUNCEMENTS: "push
    // domyślnie wysyłany, nadal respektując master push/device
    // capability") - the master switch check above and the per-Section
    // mute check below still apply in full.
    const bypassesCategoryPreference =
      notification.type === NotificationType.IMPORTANT_ANNOUNCEMENT_PUBLISHED;

    const categoryField = CATEGORY_PREFERENCE_FIELD[notification.category];
    if (
      !bypassesCategoryPreference &&
      categoryField &&
      preferences &&
      preferences[categoryField] === false
    ) {
      return false;
    }

    // Exact-resource only, never inherited: a Notification carries exactly
    // one of contextGroup/contextSection (set at the point it was raised -
    // see e.g. EventNotificationsService/TrainingNotificationsService), so
    // this always reads the single most specific community's own settings
    // row, never a parent/child's (module spec § GROUP MUTE SEMANTICS -
    // "Exact-resource only... Nie buduj hierarchy-based mute").
    const contextCommunityId =
      notification.contextSection?.id ?? notification.contextGroup?.id;
    if (contextCommunityId) {
      const settings = context.communitySettings.get(contextCommunityId);
      if (settings?.muted) {
        return false;
      }
      // The five fine-grained membership toggles are a Section-only concept
      // (see CommunityNotificationSettings' own comment) - never consulted
      // for a contextGroup Notification, even if MEMBERSHIP_TYPE_SETTINGS_FIELD
      // happened to have an entry for its type (it never does in practice,
      // since every type in that map is only ever raised with a
      // contextSection).
      if (notification.contextSection) {
        const settingsField = MEMBERSHIP_TYPE_SETTINGS_FIELD[notification.type];
        if (settingsField && settings && settings[settingsField] === false) {
          return false;
        }
      }
    }

    return true;
  }

  private async loadRecipientContexts(
    em: EntityManager,
    recipientIds: string[],
  ): Promise<Map<string, RecipientDeliveryContext>> {
    const [preferencesRows, deviceRows, settingsRows] = await Promise.all([
      em.find(UserNotificationPreferences, {
        user: { $in: recipientIds },
      }),
      em.find(PushDevice, {
        user: { $in: recipientIds },
        isActive: true,
      }),
      em.find(CommunityNotificationSettings, {
        user: { $in: recipientIds },
      }),
    ]);

    const preferencesByUser = new Map(
      preferencesRows.map((p) => [p.user.id, p]),
    );
    const devicesByUser = new Map<string, PushDevice[]>();
    for (const device of deviceRows) {
      const list = devicesByUser.get(device.user.id) ?? [];
      list.push(device);
      devicesByUser.set(device.user.id, list);
    }
    const settingsByUser = new Map<
      string,
      Map<string, CommunityNotificationSettings>
    >();
    for (const settings of settingsRows) {
      const map =
        settingsByUser.get(settings.user.id) ??
        new Map<string, CommunityNotificationSettings>();
      map.set(communitySettingsCommunityId(settings), settings);
      settingsByUser.set(settings.user.id, map);
    }

    const result = new Map<string, RecipientDeliveryContext>();
    for (const recipientId of recipientIds) {
      result.set(recipientId, {
        preferences: preferencesByUser.get(recipientId) ?? null,
        devices: devicesByUser.get(recipientId) ?? [],
        communitySettings:
          settingsByUser.get(recipientId) ??
          new Map<string, CommunityNotificationSettings>(),
      });
    }
    return result;
  }

  private async sendInChunks(
    em: EntityManager,
    messages: ExpoPushMessage[],
    devices: PushDevice[],
  ): Promise<void> {
    for (
      let offset = 0;
      offset < messages.length;
      offset += EXPO_PUSH_MAX_MESSAGES_PER_REQUEST
    ) {
      const chunkMessages = messages.slice(
        offset,
        offset + EXPO_PUSH_MAX_MESSAGES_PER_REQUEST,
      );
      const chunkDevices = devices.slice(
        offset,
        offset + EXPO_PUSH_MAX_MESSAGES_PER_REQUEST,
      );

      let tickets;
      try {
        tickets = await this.expoPushTransport.send(chunkMessages);
      } catch (error) {
        // A transient/whole-request failure never deactivates any device
        // (module spec section 17) - just logged.
        this.logger.error('Expo push request failed', error as Error);
        continue;
      }

      await this.handleTickets(em, tickets, chunkDevices);
    }
  }

  /**
   * Only a permanent-invalid ticket (DeviceNotRegistered or equivalent)
   * deactivates its device (module spec section 17) - any other error
   * status is logged and left alone, since it may well be transient.
   */
  private async handleTickets(
    em: EntityManager,
    tickets: { status: string; details?: { error?: string } }[],
    devices: PushDevice[],
  ): Promise<void> {
    const toDeactivate: PushDevice[] = [];
    tickets.forEach((ticket, index) => {
      if (ticket.status !== 'error') {
        return;
      }
      const device = devices[index];
      if (!device) {
        return;
      }
      if (ticket.details?.error === 'DeviceNotRegistered') {
        toDeactivate.push(device);
      } else {
        this.logger.warn(
          `Push delivery error for device ${device.id}: ${ticket.details?.error ?? 'unknown'}`,
        );
      }
    });

    if (toDeactivate.length === 0) {
      return;
    }
    for (const device of toDeactivate) {
      device.isActive = false;
    }
    await em.flush();
  }
}
