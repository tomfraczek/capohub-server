/**
 * E2E tests for User.displayNameMode ("Sposób wyświetlania nazwy") against
 * a real database - the parts no unit test can prove: the default for a
 * fresh account, save + re-read through PATCH/GET /users/me/profile, and
 * User.currentRankTitle (a SQL @Formula) resolving the *active, confirmed*
 * rank - formal or independent - live on every read. Names are observed
 * the way another user sees them (GET /users/search as a separate
 * viewer), plus the full profile (GET /users/:userId/profile), which must
 * keep showing the full name whatever the mode.
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
import { closeE2eApp } from './close-e2e-app.helper';
import { setAndConfirmFormalRank } from './formal-rank-confirm.helper';
import { createFreshGroupOwner } from './fresh-group-owner.helper';
import { User } from '../src/users/entities/user.entity';
import { DisplayNameMode } from '../src/users/enums/display-name-mode.enum';
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { PublicUserProfileResponseDto } from '../src/users/dto/public-user-profile-response.dto';
import { UserSearchListResponseDto } from '../src/users/dto/user-search-result.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import { PendingFormalRankResponseDto } from '../src/graduation/dto/formal-rank-request-response.dto';
import { RankResponseDto } from '../src/graduation/dto/rank-response.dto';
import { CustomUserRank } from '../src/graduation/entities/custom-user-rank.entity';
import { FormalRankAssignment } from '../src/graduation/entities/formal-rank-assignment.entity';
import { FormalRankRequest } from '../src/graduation/entities/formal-rank-request.entity';
import { GraduationSystem } from '../src/graduation/entities/graduation-system.entity';
import { Rank } from '../src/graduation/entities/rank.entity';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';
import { Notification } from '../src/notifications/entities/notification.entity';

const suffix = `${Date.now()}`;

const VIEWER_TOKEN = `valid-dnm-viewer-token-${suffix}`;
const INDEPENDENT_TOKEN = `valid-dnm-independent-token-${suffix}`;
const FORMAL_TOKEN = `valid-dnm-formal-token-${suffix}`;
const NO_APELIDO_TOKEN = `valid-dnm-no-apelido-token-${suffix}`;

const TOKENS = [
  VIEWER_TOKEN,
  INDEPENDENT_TOKEN,
  FORMAL_TOKEN,
  NO_APELIDO_TOKEN,
];

function clerkIdFor(token: string): string {
  return `user_test_${token.replace(/-/g, '_')}`;
}

const TOKEN_TO_AUTH: Record<string, AuthContext> = Object.fromEntries(
  TOKENS.map((token) => {
    const clerkId = clerkIdFor(token);
    return [
      token,
      {
        userId: clerkId,
        sessionId: `sess_${clerkId}`,
        tokenType: 'session_token',
        claims: { sub: clerkId, sid: `sess_${clerkId}` },
      },
    ];
  }),
);

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = Object.fromEntries(
  TOKENS.map((token) => {
    const clerkId = clerkIdFor(token);
    return [
      clerkId,
      {
        imageUrl: `https://img.clerk.com/${clerkId}.png`,
        primaryEmailAddress: { emailAddress: `${clerkId}@example.com` },
      },
    ];
  }),
);

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

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

function oneSegment(colorHex = '#123456') {
  return [{ position: 1, colorHex, proportion: 100 }];
}

describe('Display name mode (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const userIdByToken = new Map<string, string>();

  // Distinctive per run, so GET /users/search finds exactly these users.
  const INDEPENDENT_APELIDO = `Lagarto${suffix}`;
  const FORMAL_APELIDO = `Gato${suffix}`;
  const NO_APELIDO_FIRST = `Bez${suffix}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
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

    for (const token of TOKENS) {
      const profile = await getOwnProfile(token);
      userIdByToken.set(token, profile.userId);
    }
    await patchProfile(INDEPENDENT_TOKEN, {
      firstName: 'Tomasz',
      lastName: 'Frączek',
      apelido: INDEPENDENT_APELIDO,
    });
    await patchProfile(FORMAL_TOKEN, {
      firstName: 'Ana',
      lastName: 'Silva',
      apelido: FORMAL_APELIDO,
    });
    await patchProfile(NO_APELIDO_TOKEN, {
      firstName: NO_APELIDO_FIRST,
      lastName: 'Nowak',
    });
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      const userIds = [...userIdByToken.values()];
      await cleanup.nativeDelete(Notification, {
        recipient: { $in: userIds },
      });
      await cleanup.nativeDelete(FormalRankRequest, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(FormalRankAssignment, {
        user: { $in: userIds },
      });
      await cleanup.nativeDelete(CustomUserRank, { user: { $in: userIds } });
      const systems = await cleanup.find(GraduationSystem, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Rank, {
        system: { $in: systems.map((s) => s.id) },
      });
      await cleanup.nativeDelete(GraduationSystem, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(RoleAssignment, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
  });

  function getOwnProfile(token: string): Promise<UserProfileResponseDto> {
    return bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  function patchProfile(
    token: string,
    body: Record<string, unknown>,
    expectStatus = 200,
  ): Promise<UserProfileResponseDto> {
    return bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(expectStatus),
    );
  }

  // The name `token`'s user is shown with to *another* user (the viewer).
  async function nameSeenByOthers(
    token: string,
    searchText: string,
  ): Promise<string | undefined> {
    const result = await bodyOf<UserSearchListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/search')
        .query({ search: searchText })
        .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
        .expect(200),
    );
    return result.items.find((item) => item.id === userIdByToken.get(token))
      ?.displayName;
  }

  function setIndependentRank(token: string, name: string): Promise<unknown> {
    return bodyOf(
      request(app.getHttpServer())
        .put('/api/v1/users/me/custom-rank')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name,
          description: null,
          track: RankTrack.ADULT,
          cordSegments: oneSegment(),
        })
        .expect(200),
    );
  }

  describe('stored preference', () => {
    it('defaults a fresh account to FULL_NAME', async () => {
      const profile = await getOwnProfile(VIEWER_TOKEN);
      expect(profile.displayNameMode).toBe(DisplayNameMode.FULL_NAME);
    });

    it('saves TITLE_APELIDO and reads it back on a later request', async () => {
      const patched = await patchProfile(NO_APELIDO_TOKEN, {
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
      });
      expect(patched.displayNameMode).toBe(DisplayNameMode.TITLE_APELIDO);

      const reread = await getOwnProfile(NO_APELIDO_TOKEN);
      expect(reread.displayNameMode).toBe(DisplayNameMode.TITLE_APELIDO);
    });

    it('rejects an unknown mode', async () => {
      await patchProfile(VIEWER_TOKEN, { displayNameMode: 'NICKNAME' }, 400);
    });

    it('falls back to the full name for TITLE_APELIDO without an apelido', async () => {
      await patchProfile(NO_APELIDO_TOKEN, {
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
      });
      expect(await nameSeenByOthers(NO_APELIDO_TOKEN, NO_APELIDO_FIRST)).toBe(
        `${NO_APELIDO_FIRST} Nowak`,
      );
    });
  });

  describe('independent rank', () => {
    it('shows the full name by default, and only the apelido before any rank exists', async () => {
      expect(
        await nameSeenByOthers(INDEPENDENT_TOKEN, INDEPENDENT_APELIDO),
      ).toBe('Tomasz Frączek');

      const profile = await patchProfile(INDEPENDENT_TOKEN, {
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
      });
      expect(profile.displayNameVariants).toEqual({
        FULL_NAME: 'Tomasz Frączek',
        TITLE_APELIDO: INDEPENDENT_APELIDO,
      });
      expect(
        await nameSeenByOthers(INDEPENDENT_TOKEN, INDEPENDENT_APELIDO),
      ).toBe(INDEPENDENT_APELIDO);
    });

    it('prefixes the independent rank, and follows a rank change with no other write', async () => {
      await patchProfile(INDEPENDENT_TOKEN, {
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
      });
      await setIndependentRank(INDEPENDENT_TOKEN, 'Graduado');
      expect(
        await nameSeenByOthers(INDEPENDENT_TOKEN, INDEPENDENT_APELIDO),
      ).toBe(`Graduado ${INDEPENDENT_APELIDO}`);

      await setIndependentRank(INDEPENDENT_TOKEN, 'Instrutor');
      expect(
        await nameSeenByOthers(INDEPENDENT_TOKEN, INDEPENDENT_APELIDO),
      ).toBe(`Instrutor ${INDEPENDENT_APELIDO}`);
      expect(
        (await getOwnProfile(INDEPENDENT_TOKEN)).displayNameVariants
          .TITLE_APELIDO,
      ).toBe(`Instrutor ${INDEPENDENT_APELIDO}`);
    });

    it('drops the title (keeps the apelido) while the rank is hidden by showFormalRank', async () => {
      await patchProfile(INDEPENDENT_TOKEN, {
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
        showFormalRank: false,
      });
      expect(
        await nameSeenByOthers(INDEPENDENT_TOKEN, INDEPENDENT_APELIDO),
      ).toBe(INDEPENDENT_APELIDO);

      await patchProfile(INDEPENDENT_TOKEN, { showFormalRank: true });
    });

    it('switches back to the full name under FULL_NAME, keeping the rank', async () => {
      await patchProfile(INDEPENDENT_TOKEN, {
        displayNameMode: DisplayNameMode.FULL_NAME,
      });
      expect(
        await nameSeenByOthers(INDEPENDENT_TOKEN, INDEPENDENT_APELIDO),
      ).toBe('Tomasz Frączek');
    });

    it('never changes the full profile, whatever the mode', async () => {
      await patchProfile(INDEPENDENT_TOKEN, {
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
      });
      const profile = await bodyOf<PublicUserProfileResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/${userIdByToken.get(INDEPENDENT_TOKEN)}/profile`)
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(profile.displayName).toBe('Tomasz Frączek');
      expect(profile.firstName).toBe('Tomasz');
      expect(profile.lastName).toBe('Frączek');
      expect(profile.apelido).toBe(INDEPENDENT_APELIDO);
      expect(profile.independentRank?.name).toBe('Instrutor');
    });
  });

  describe('formal rank', () => {
    it('uses the confirmed formal rank, and keeps it while a newer one awaits approval', async () => {
      const owner = await createFreshGroupOwner({
        app,
        tokenToAuth: TOKEN_TO_AUTH,
        clerkProfiles: FIXTURE_CLERK_PROFILES,
        onGroupCreated: (id) => createdGroupIds.push(id),
        namePrefix: 'dnm',
      });
      userIdByToken.set(owner.token, owner.userId);
      const groupId = owner.group.id;
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/graduation-system`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(201)
        .then((res) => res.body as GraduationSystemResponseDto);
      const createRank = (name: string, previousRankId: string | null) =>
        bodyOf<RankResponseDto>(
          request(app.getHttpServer())
            .post(`/api/v1/groups/${groupId}/ranks`)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({
              track: RankTrack.ADULT,
              name,
              description: null,
              previousRankId,
              cordSegments: oneSegment(),
            })
            .expect(201),
        );
      const graduado = await createRank('Graduado', null);
      const instrutor = await createRank('Instrutor', graduado.id);

      await request(app.getHttpServer())
        .put('/api/v1/users/me/formal-group')
        .set('Authorization', `Bearer ${FORMAL_TOKEN}`)
        .send({ groupId })
        .expect(200);
      await patchProfile(FORMAL_TOKEN, {
        displayNameMode: DisplayNameMode.TITLE_APELIDO,
      });

      await setAndConfirmFormalRank(app, FORMAL_TOKEN, {
        rankId: graduado.id,
      });
      expect(await nameSeenByOthers(FORMAL_TOKEN, FORMAL_APELIDO)).toBe(
        `Graduado ${FORMAL_APELIDO}`,
      );

      // A promotion that only creates a PENDING request changes nothing yet.
      const pending = await bodyOf<PendingFormalRankResponseDto>(
        request(app.getHttpServer())
          .put('/api/v1/users/me/formal-rank')
          .set('Authorization', `Bearer ${FORMAL_TOKEN}`)
          .send({ rankId: instrutor.id })
          .expect(202),
      );
      expect(await nameSeenByOthers(FORMAL_TOKEN, FORMAL_APELIDO)).toBe(
        `Graduado ${FORMAL_APELIDO}`,
      );

      // Approval makes it the active rank - the name follows on its own.
      await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${groupId}/formal-rank-requests/${pending.pendingRequest.id}/approve`,
        )
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);
      expect(await nameSeenByOthers(FORMAL_TOKEN, FORMAL_APELIDO)).toBe(
        `Instrutor ${FORMAL_APELIDO}`,
      );
    });
  });
});
