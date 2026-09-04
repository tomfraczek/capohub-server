/**
 * E2E tests for the Notifications module's self-service preference surface
 * (module spec §§10-14, 39-40, 44-45): global UserNotificationPreferences,
 * per-Section CommunityNotificationSettings.muted, and push device
 * registration (idempotent register, ownership-scoped unregister).
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
import { Group } from '../src/groups/entities/group.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { Section } from '../src/groups/entities/section.entity';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { CommunityNotificationSettings } from '../src/groups/entities/community-notification-settings.entity';
import { CommunityNotificationSettingsResponseDto } from '../src/groups/dto/community-notification-settings-response.dto';
import { GroupNotificationSettingsResponseDto } from '../src/groups/dto/group-notification-settings-response.dto';
import { UserNotificationPreferences } from '../src/notifications/entities/user-notification-preferences.entity';
import { UserNotificationPreferencesResponseDto } from '../src/notifications/dto/user-notification-preferences-response.dto';
import { PushDevice } from '../src/notifications/entities/push-device.entity';
import { PushDeviceResponseDto } from '../src/notifications/dto/push-device-response.dto';
import { ExpoPushTransport } from '../src/notifications/expo-push.transport';

const OWNER_TOKEN = 'valid-notif-prefs-owner-token';
const OTHER_TOKEN = 'valid-notif-prefs-other-token';

const OWNER_CLERK_ID = 'user_test_notif_prefs_owner';
const OTHER_CLERK_ID = 'user_test_notif_prefs_other';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_notif_prefs_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_notif_prefs_owner' },
  },
  [OTHER_TOKEN]: {
    userId: OTHER_CLERK_ID,
    sessionId: 'sess_notif_prefs_other',
    tokenType: 'session_token',
    claims: { sub: OTHER_CLERK_ID, sid: 'sess_notif_prefs_other' },
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

const fixtureExpoPushTransport = { send: () => Promise.resolve([]) };

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

describe('Notification preferences / devices (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
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
      await cleanup.nativeDelete(PushDevice, {
        user: { $in: [...localUserIdByToken.values()] },
      });
      await cleanup.nativeDelete(UserNotificationPreferences, {
        user: { $in: [...localUserIdByToken.values()] },
      });
      await cleanup.nativeDelete(CommunityNotificationSettings, {
        $or: [
          { communityGroup: { $in: createdGroupIds } },
          { communitySection: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(Section, {
        parentGroup: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function groupPayload(): Record<string, unknown> {
    return {
      name: 'Notif Prefs Test Org',
      description: null,
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      isPublic: true,
      isHidden: false,
      memberInvitesAllowed: false,
    };
  }

  function sectionPayload(): Record<string, unknown> {
    return {
      name: 'Notif Prefs Test Section',
      description: null,
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      isPublic: true,
      isHidden: false,
      memberInvitesAllowed: false,
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
      country: 'PL',
      city: 'Warsaw',
      region: 'Mazovia',
      geonameId: 756135,
    };
  }

  async function createSectionWithOwnerAsMember(): Promise<SectionResponseDto> {
    const group = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(groupPayload())
        .expect(201),
    );
    createdGroupIds.push(group.id);
    const section = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/sections`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(sectionPayload())
        .expect(201),
    );
    createdGroupIds.push(section.id);
    return section;
  }

  async function createGroupOnly(): Promise<GroupResponseDto> {
    const group = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(groupPayload())
        .expect(201),
    );
    createdGroupIds.push(group.id);
    return group;
  }

  describe('GET/PATCH /users/me/notification-preferences', () => {
    it('returns every default as true when no row exists yet', async () => {
      const result = await bodyOf<UserNotificationPreferencesResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/notification-preferences')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(result).toEqual({
        pushEnabled: true,
        pushCommunity: true,
        pushTraining: true,
        pushEvent: true,
        pushMembership: true,
        pushGraduation: true,
        pushPayment: true,
        trainingReminder24h: true,
        trainingReminder2h: true,
        eventReminder24h: true,
        eventReminder2h: true,
      });
    });

    it('a partial PATCH only changes the given fields, viewing never writes anything', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/users/me/notification-preferences')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ pushTraining: false, trainingReminder2h: false })
        .expect(200);

      const result = await bodyOf<UserNotificationPreferencesResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/notification-preferences')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(result.pushTraining).toBe(false);
      expect(result.trainingReminder2h).toBe(false);
      // Untouched fields keep their defaults.
      expect(result.pushEvent).toBe(true);
      expect(result.pushEnabled).toBe(true);
    });

    it('the master pushEnabled switch is independently settable from category toggles', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/users/me/notification-preferences')
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .send({ pushEnabled: false })
        .expect(200);

      const result = await bodyOf<UserNotificationPreferencesResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/notification-preferences')
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(200),
      );
      expect(result.pushEnabled).toBe(false);
      expect(result.pushTraining).toBe(true);
    });

    it('returns 401 unauthenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me/notification-preferences')
        .expect(401);
    });
  });

  describe('GET/PATCH /sections/:sectionId/notification-settings (muted)', () => {
    it('defaults muted=false, and PATCH round-trips true', async () => {
      const section = await createSectionWithOwnerAsMember();

      const before = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/notification-settings`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(before.muted).toBe(false);

      const after = await bodyOf<CommunityNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/sections/${section.id}/notification-settings`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ muted: true })
          .expect(200),
      );
      expect(after.muted).toBe(true);
      // Untouched fields keep their defaults.
      expect(after.newJoinRequests).toBe(true);
    });
  });

  describe('GET/PATCH /groups/:groupId/notification-settings (muted)', () => {
    it('defaults muted=false, and PATCH round-trips true - minimal {communityId, muted} shape only', async () => {
      const group = await createGroupOnly();

      const before = await bodyOf<GroupNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/notification-settings`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(before).toEqual({ communityId: group.id, muted: false });

      const after = await bodyOf<GroupNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/notification-settings`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ muted: true })
          .expect(200),
      );
      expect(after).toEqual({ communityId: group.id, muted: true });

      const refetched = await bodyOf<GroupNotificationSettingsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/notification-settings`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(refetched.muted).toBe(true);
    });

    it('returns 404 GROUP_NOT_FOUND for a caller with no RoleAssignment on this Group, never revealing it exists', async () => {
      const group = await createGroupOnly();

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/notification-settings`)
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('GROUP_NOT_FOUND');
    });

    it('rejects an unrecognized field with 400 (schema is strict, only muted is settable)', async () => {
      const group = await createGroupOnly();

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${group.id}/notification-settings`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ newJoinRequests: false })
        .expect(400);
    });

    it('a Section id 404s at the Group endpoint - exact-resource routing, no cross-resolution', async () => {
      const section = await createSectionWithOwnerAsMember();

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${section.id}/notification-settings`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });
  });

  describe('POST/DELETE /users/me/push-devices', () => {
    it('registers a device and lets it be unregistered by its owner', async () => {
      const device = await bodyOf<PushDeviceResponseDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/push-devices')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            token: 'ExponentPushToken[e2e-owner-device]',
            platform: 'IOS',
          })
          .expect(201),
      );
      expect(device.isActive).toBe(true);

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/push-devices/${device.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });

    it('registering the same token twice is idempotent - same row, not a duplicate', async () => {
      const first = await bodyOf<PushDeviceResponseDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/push-devices')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ token: 'ExponentPushToken[e2e-dup-device]', platform: 'IOS' })
          .expect(201),
      );
      const second = await bodyOf<PushDeviceResponseDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/push-devices')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ token: 'ExponentPushToken[e2e-dup-device]', platform: 'IOS' })
          .expect(201),
      );

      expect(second.id).toBe(first.id);

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/push-devices/${first.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });

    it('re-registering a token under a different account reassigns ownership, never leaks to the old owner', async () => {
      const original = await bodyOf<PushDeviceResponseDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/push-devices')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            token: 'ExponentPushToken[e2e-reassign-device]',
            platform: 'ANDROID',
          })
          .expect(201),
      );

      await request(app.getHttpServer())
        .post('/api/v1/users/me/push-devices')
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .send({
          token: 'ExponentPushToken[e2e-reassign-device]',
          platform: 'ANDROID',
        })
        .expect(201);

      // The previous owner can no longer unregister it - it is no longer theirs.
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/users/me/push-devices/${original.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('PUSH_DEVICE_NOT_FOUND');

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/push-devices/${original.id}`)
        .set('Authorization', `Bearer ${OTHER_TOKEN}`)
        .expect(204);
    });

    it('DELETE 404s (IDOR-safe) for a device belonging to someone else', async () => {
      const device = await bodyOf<PushDeviceResponseDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/push-devices')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            token: 'ExponentPushToken[e2e-idor-device]',
            platform: 'IOS',
          })
          .expect(201),
      );

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/users/me/push-devices/${device.id}`)
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('PUSH_DEVICE_NOT_FOUND');

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/push-devices/${device.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });

    it('rejects an invalid platform value', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/me/push-devices')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          token: 'ExponentPushToken[e2e-bad-platform]',
          platform: 'WINDOWS_PHONE',
        })
        .expect(400);
    });
  });
});
