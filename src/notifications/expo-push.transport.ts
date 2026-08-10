import { Injectable, Logger } from '@nestjs/common';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
// Expo's documented hard cap per request - see
// https://docs.expo.dev/push-notifications/sending-notifications/#push-tickets.
export const EXPO_PUSH_MAX_MESSAGES_PER_REQUEST = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * The one, thin adapter around Expo's push HTTP API (module spec section
 * 16 - "nie buduj własnej infrastruktury APNs/FCM"). No SDK dependency:
 * `expo-server-sdk` was not already a dependency of this project (verified
 * during research), and this codebase has no other outbound-HTTP
 * convention to align with either, so a direct `fetch` against Expo's own
 * documented REST endpoint is the minimal, still-official integration the
 * module spec asks for rather than adding a new dependency for two
 * lines of behavior. Deliberately separated from NotificationPushService
 * (module spec section 48) so every domain/preference/mute decision can be
 * unit-tested without ever making a real HTTP call - tests mock this class
 * directly.
 */
@Injectable()
export class ExpoPushTransport {
  private readonly logger = new Logger(ExpoPushTransport.name);

  /** Caller is responsible for chunking to EXPO_PUSH_MAX_MESSAGES_PER_REQUEST. */
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (messages.length === 0) {
      return [];
    }

    const response = await fetch(EXPO_PUSH_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      throw new Error(`Expo push API responded with HTTP ${response.status}`);
    }

    const json = (await response.json()) as { data?: ExpoPushTicket[] };
    return json.data ?? [];
  }
}
