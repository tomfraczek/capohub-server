/**
 * E2E tests for the central Notifications inbox (module spec §§7-9, 39-40,
 * 43): list/pagination/unreadOnly, unread-count, mark-read (idempotent),
 * mark-all-read, and IDOR (a user only ever sees/mutates their own rows).
 * Domain integrations (what actually creates a Notification) are covered
 * separately in notification-integrations.e2e-spec.ts.
 */

import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { closeE2eApp } from './close-e2e-app.helper';
import { User } from '../src/users/entities/user.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationCategory } from '../src/notifications/enums/notification-category.enum';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
import { NotificationListResponseDto } from '../src/notifications/dto/notification-list-response.dto';
import { UnreadCountResponseDto } from '../src/notifications/dto/unread-count-response.dto';
import { ExpoPushTransport } from '../src/notifications/expo-push.transport';

const OWNER_TOKEN = 'valid-notif-inbox-owner-token';
const OTHER_TOKEN = 'valid-notif-inbox-other-token';

const OWNER_CLERK_ID = 'user_test_notif_inbox_owner';
const OTHER_CLERK_ID = 'user_test_notif_inbox_other';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_notif_inbox_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_notif_inbox_owner' },
  },
  [OTHER_TOKEN]: {
    userId: OTHER_CLERK_ID,
    sessionId: 'sess_notif_inbox_other',
    tokenType: 'session_token',
    claims: { sub: OTHER_CLERK_ID, sid: 'sess_notif_inbox_other' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = Object.fromEntries(
  Object.keys(TOKEN_TO_AUTH).map((token) => {
    const clerkId = TOKEN_TO_AUTH[token].userId;
    return [
      clerkId,
      {
        imageUrl: `https://img.clerk.com/${clerkId}.png`,
        primaryEmailAddress: { emailAddress: `${clerkId}@example.com` },
      },
    ];
  }),
);

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    const auth = TOKEN_TO_AUTH[token];
    if (auth) return Promise.resolve(auth);
    return Promise.reject(new UnauthorizedException('Authentication required'));
  },
};

const fixtureClerkClient = {
  users: {
    getUser: (clerkUserId: string) => {
      const profile = FIXTURE_CLERK_PROFILES[clerkUserId];
      if (!profile) {
        return Promise.reject(
          new Error(`Unknown test Clerk user ${clerkUserId}`),
        );
      }
      return Promise.resolve({ id: clerkUserId, ...profile });
    },
    deleteUser: () => Promise.resolve(),
  },
};

// Never a real Expo HTTP call from any e2e test (module spec §42) - a
// no-device recipient never reaches this anyway, but overriding the
// transport is a deliberate safety net regardless.
const fixtureExpoPushTransport = { send: () => Promise.resolve([]) };

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

describe('Notifications inbox (e2e)', () => {
  let app: INestApplication<App>;
  const localUserIdByToken = new Map<string, string>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
      .overrideProvider(ExpoPushTransport)
      .useValue(fixtureExpoPushTransport)
      .compile();

    app = moduleFixture.createNestApplication();
    const appConfig = app.get(AppConfigService);
    app.setGlobalPrefix(appConfig.apiPrefix);
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: appConfig.apiVersion,
      prefix: false,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, {
        clerkUserId: TOKEN_TO_AUTH[token].userId,
      });
      localUserIdByToken.set(token, user.id);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(Notification, {
        recipient: { $in: [...localUserIdByToken.values()] },
      });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  async function seedNotification(
    token: string,
    overrides: Partial<Notification> = {},
  ): Promise<string> {
    const em = app.get(EntityManager).fork();
    const notification = new Notification();
    notification.recipient = em.getReference(
      User,
      localUserIdByToken.get(token)!,
    );
    notification.category = NotificationCategory.TRAINING;
    notification.type = NotificationType.TRAINING_CANCELLED;
    notification.title = 'Trening odwołany';
    notification.body = 'Trening odwołany.';
    Object.assign(notification, overrides);
    await em.persist(notification).flush();
    return notification.id;
  }

  afterEach(async () => {
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(Notification, {
      recipient: { $in: [...localUserIdByToken.values()] },
    });
  });

  it('returns 401 for an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
  });

  it("lists only the caller's own Notifications, newest first", async () => {
    const older = await seedNotification(OWNER_TOKEN, {
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newer = await seedNotification(OWNER_TOKEN, {
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await seedNotification(OTHER_TOKEN);

    const result = await bodyOf<NotificationListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );

    expect(result.items.map((i) => i.id)).toEqual([newer, older]);
    expect(result.total).toBe(2);
  });

  it('paginates via limit/offset and reports hasMore correctly', async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedNotification(OWNER_TOKEN, {
        createdAt: new Date(2026, 0, i + 1),
      });
    }

    const page1 = await bodyOf<NotificationListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications?limit=2&offset=0')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await bodyOf<NotificationListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications?limit=2&offset=2')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('unreadOnly=true excludes already-read Notifications', async () => {
    const read = await seedNotification(OWNER_TOKEN, { readAt: new Date() });
    const unread = await seedNotification(OWNER_TOKEN, { readAt: null });

    const result = await bodyOf<NotificationListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );

    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(unread);
    expect(ids).not.toContain(read);
  });

  it("GET /notifications/unread-count counts only this recipient's unread rows", async () => {
    await seedNotification(OWNER_TOKEN, { readAt: null });
    await seedNotification(OWNER_TOKEN, { readAt: null });
    await seedNotification(OWNER_TOKEN, { readAt: new Date() });
    await seedNotification(OTHER_TOKEN, { readAt: null });

    const result = await bodyOf<UnreadCountResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );

    expect(result.count).toBe(2);
  });

  it('POST /notifications/:id/read marks it read and is idempotent on repeat', async () => {
    const id = await seedNotification(OWNER_TOKEN, { readAt: null });

    await request(app.getHttpServer())
      .post(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(204);

    const afterFirst = await bodyOf<NotificationListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );
    const readAtFirst = afterFirst.items.find((i) => i.id === id)?.readAt;
    expect(readAtFirst).not.toBeNull();

    // Repeat - no error, readAt unchanged in shape (still a Date string).
    await request(app.getHttpServer())
      .post(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(204);
  });

  it("POST /notifications/:id/read 404s (IDOR-safe) for another user's Notification", async () => {
    const id = await seedNotification(OTHER_TOKEN);

    const error = await bodyOf<HttpErrorResponse>(
      request(app.getHttpServer())
        .post(`/api/v1/notifications/${id}/read`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404),
    );
    expect(error.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('POST /notifications/read-all marks every unread row for this user, and only this user', async () => {
    await seedNotification(OWNER_TOKEN, { readAt: null });
    await seedNotification(OWNER_TOKEN, { readAt: null });
    const otherUnread = await seedNotification(OTHER_TOKEN, { readAt: null });

    await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(204);

    const ownerUnread = await bodyOf<UnreadCountResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );
    expect(ownerUnread.count).toBe(0);

    const otherList = await bodyOf<NotificationListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(200),
    );
    expect(
      otherList.items.find((i) => i.id === otherUnread)?.readAt,
    ).toBeNull();

    // Repeat - nothing left to mark, still succeeds.
    await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(204);
  });
});
