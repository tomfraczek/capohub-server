import { Injectable } from '@nestjs/common';
import {
  PushNotificationPayload,
  PushNotificationPort,
  PushSendResult,
} from './push-notification.port';

// Default binding for PushNotificationPort until a real push provider
// exists - see push-notification.port.ts. Intentionally fails honest, not
// closed-and-silent: it reports the send as genuinely attempted but
// unsent, rather than pretending success (task requirement: "Nie zwracaj
// fikcyjnego sukcesu bez próby wysłania") or silently doing nothing without
// telling the caller.
/* eslint-disable @typescript-eslint/no-unused-vars -- payload is fixed by PushNotificationPort's signature; this implementation intentionally ignores it until a real push provider exists */
@Injectable()
export class NullPushNotificationService implements PushNotificationPort {
  sendToUsers(
    userIds: string[],
    payload: PushNotificationPayload,
  ): Promise<PushSendResult> {
    return Promise.resolve({
      attempted: userIds.length,
      sent: 0,
      failed: userIds.length,
    });
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
