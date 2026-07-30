// Placeholder integration seam for push notification delivery. Nothing in
// this codebase can send a real push today: there is no device/push-token
// entity or table anywhere (no way to know which device(s) a user even
// has), no push provider SDK in package.json (no Expo/FCM/APNs client), and
// no notifications module. `CommunityNotificationSettings` is a look-alike
// but is explicitly *preference storage only* - see its own entity comment
// ("whether and how notifications are actually delivered... is a future
// Notifications module's concern").
//
// Building a real device-token table/registration flow is a separate,
// larger prerequisite this task does not ask for - see
// AnnouncementsService's own comment and the final report's "deviations"
// section. Until a real push provider is wired in:
//  - NullPushNotificationService.sendToUsers() always reports every
//    attempted send as failed (never fabricates success - see
//    AnnouncementsService, which calls this only after a publish has
//    already committed, so a failed/absent send never rolls anything back).
//
// Swapping in a real provider later means providing a new implementation
// of this interface and rebinding PUSH_NOTIFICATION_PORT in
// AnnouncementsModule - no change to any Announcement entity, service, or
// endpoint contract required.
export interface PushNotificationPayload {
  title: string;
  body: string;
}

export interface PushSendResult {
  attempted: number;
  sent: number;
  failed: number;
}

export interface PushNotificationPort {
  /**
   * Attempts to deliver `payload` to every one of `userIds` (already
   * deduplicated by the caller - see AnnouncementsService). Always resolves
   * (never throws) - a provider-level failure is reported through the
   * returned counts, never as a rejected promise, since a single bad token
   * must never fail the whole send, let alone the Announcement publish
   * that triggered it.
   */
  sendToUsers(
    userIds: string[],
    payload: PushNotificationPayload,
  ): Promise<PushSendResult>;
}

export const PUSH_NOTIFICATION_PORT = Symbol('PUSH_NOTIFICATION_PORT');
