/**
 * E2E tests for GET /home (mobile Home screen aggregate).
 *
 * Scenarios:
 *  1. Unauthenticated request -> 401
 *  2. Brand new user -> greetingName derived from their email, every
 *     section in its documented empty state
 *  3. The soonest upcoming Event (any type) becomes nearestEvent; the
 *     soonest upcoming OPEN_TRAINING Event becomes nearestTraining, even
 *     when it is a later, different Event
 *  4. continueLearning.toReview only ever contains TO_REVIEW rows
 *  5. The response never carries an `announcements`, `birthdays`, or
 *     `continueLearning.lastActive` field - neither has a real backing
 *     module in this codebase (see home-response.dto.ts)
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
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { HomeResponseDto } from '../src/home/dto/home-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventGuardianAssignment } from '../src/events/entities/event-guardian-assignment.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { Song } from '../src/songs/entities/song.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';
import { User } from '../src/users/entities/user.entity';

const OWNER_TOKEN = 'valid-home-owner-token';
const MEMBER_TOKEN = 'valid-home-member-token';
const NEWUSER_TOKEN = 'valid-home-newuser-token';

const OWNER_CLERK_ID = 'user_test_home_owner';
const MEMBER_CLERK_ID = 'user_test_home_member';
const NEWUSER_CLERK_ID = 'user_test_home_newuser';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_home_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_home_owner' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_home_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_home_member' },
  },
  [NEWUSER_TOKEN]: {
    userId: NEWUSER_CLERK_ID,
    sessionId: 'sess_home_newuser',
    tokenType: 'session_token',
    claims: { sub: NEWUSER_CLERK_ID, sid: 'sess_home_newuser' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/home-owner.png',
    primaryEmailAddress: { emailAddress: 'home.owner@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/home-member.png',
    primaryEmailAddress: { emailAddress: 'home.member@example.com' },
  },
  [NEWUSER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/home-newuser.png',
    primaryEmailAddress: { emailAddress: 'home.newuser@example.com' },
  },
};

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

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

describe('Home (e2e)', () => {
  let app: INestApplication<App>;
  let category: SongCategory;
  const createdGroupIds: string[] = [];
  const createdSongIds: string[] = [];

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

    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    const em = app.get(EntityManager).fork();
    category = new SongCategory();
    category.code = `TEST_E2E_HOME_${randomUUID().slice(0, 8)}`;
    category.name = 'Test home category';
    category.position = 999;
    category.isActive = true;
    await em.persistAndFlush(category);
  });

  afterAll(async () => {
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(Song, { category: category.id });
    await cleanup.nativeDelete(SongCategory, { id: category.id });
    await cleanup.nativeDelete(EventGuardianAssignment, {
      event: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(EventAttendee, {
      event: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(EventInvitation, {
      event: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(EventRoleAssignment, {
      event: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(EventStatusHistory, {
      event: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(Event, { community: { $in: createdGroupIds } });
    await cleanup.nativeDelete(RoleAssignment, {
      group: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(GroupMembership, {
      rootGroup: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(AuditLogEntry, {
      community: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
    await cleanup.nativeDelete(User, {
      clerkUserId: { $in: TEST_CLERK_USER_IDS },
    });
    await app.close();
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Home Test Org',
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
      city: 'Poznań',
      region: 'Greater Poland',
      geonameId: 3088171,
      ...overrides,
    };
  }

  async function createGroup(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send(groupPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function addMember(
    ownerToken: string,
    groupId: string,
    memberToken: string,
  ): Promise<void> {
    const memberUser = await bodyOf<{ id: string }>(
      request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberUser.id, role: GroupRole.MEMBER })
      .expect(201);
  }

  function eventPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: 'WORKSHOP',
      customTypeLabel: null,
      name: 'Home Test Event',
      description: null,
      coverImageUrl: null,
      startsAt: '2031-01-10T10:00:00.000Z',
      endsAt: '2031-01-10T18:00:00.000Z',
      locationName: null,
      locationAddress: null,
      latitude: null,
      longitude: null,
      visibility: EventVisibility.COMMUNITY_MEMBERS,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  async function createAndPublishEvent(
    token: string,
    groupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    const created = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send(eventPayload(overrides))
        .expect(201),
    );
    return bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/events/${created.id}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201),
    );
  }

  function songPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const suffix = randomUUID().slice(0, 8);
    return {
      title: `Home test song ${suffix}`,
      authorName: 'Mestre Test',
      categoryId: category.id,
      alternativeTitles: [],
      tagIds: [],
      parts: [
        {
          performer: 'LEAD',
          position: 1,
          lines: [
            {
              originalText: 'Some lyric line',
              phoneticText: null,
              position: 1,
              translations: [],
            },
          ],
        },
      ],
      media: [],
      meaningHistory: null,
      meaningContext: null,
      meaningTrivia: null,
      ...overrides,
    };
  }

  async function createSong(token: string): Promise<SongDetailsResponseDto> {
    const created = await bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/songs')
        .set('Authorization', `Bearer ${token}`)
        .send(songPayload())
        .expect(201),
    );
    createdSongIds.push(created.id);
    return created;
  }

  async function setLearningStatus(
    token: string,
    songId: string,
    status: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .put(`/api/v1/songs/${songId}/learning-status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status })
      .expect(200);
  }

  async function getHome(token: string): Promise<HomeResponseDto> {
    return bodyOf<HomeResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/home')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  it('returns 401 for an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/v1/home').expect(401);
  });

  it('returns greetingName derived from the email local-part, and every section empty, for a brand new user with no data anywhere', async () => {
    const home = await getHome(NEWUSER_TOKEN);

    expect(home.greetingName).toBe('Home Newuser');
    expect(home.nearestEvent).toBeNull();
    expect(home.nearestTraining).toBeNull();
    expect(home.continueLearning).toEqual({
      toReview: { items: [], total: 0, hasMore: false },
    });
    expect(home).not.toHaveProperty('announcements');
    expect(home).not.toHaveProperty('birthdays');
  });

  describe('nearestEvent / nearestTraining', () => {
    it('the soonest upcoming Event of any type becomes nearestEvent; the soonest upcoming OPEN_TRAINING becomes nearestTraining even when it is a later, different Event', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Home Events Org',
      });
      await addMember(OWNER_TOKEN, group.id, MEMBER_TOKEN);

      const soonerWorkshop = await createAndPublishEvent(
        OWNER_TOKEN,
        group.id,
        {
          type: 'WORKSHOP',
          name: 'Sooner Workshop',
          startsAt: '2031-02-01T10:00:00.000Z',
          endsAt: '2031-02-01T18:00:00.000Z',
        },
      );
      const laterTraining = await createAndPublishEvent(OWNER_TOKEN, group.id, {
        type: 'OPEN_TRAINING',
        name: 'Later Training',
        startsAt: '2031-03-01T10:00:00.000Z',
        endsAt: '2031-03-01T12:00:00.000Z',
      });

      const home = await getHome(MEMBER_TOKEN);

      expect(home.nearestEvent?.id).toBe(soonerWorkshop.id);
      expect(home.nearestTraining?.id).toBe(laterTraining.id);
    });
  });

  describe('continueLearning', () => {
    it('toReview only ever contains TO_REVIEW rows, never a Song tracked under a different status', async () => {
      const learningSong = await createSong(MEMBER_TOKEN);
      await setLearningStatus(MEMBER_TOKEN, learningSong.id, 'LEARNING');

      const toReviewSong = await createSong(MEMBER_TOKEN);
      await setLearningStatus(MEMBER_TOKEN, toReviewSong.id, 'TO_REVIEW');

      const home = await getHome(MEMBER_TOKEN);

      expect(home.continueLearning.toReview.total).toBe(1);
      expect(home.continueLearning.toReview.items).toHaveLength(1);
      expect(home.continueLearning.toReview.items[0].id).toBe(toReviewSong.id);
      expect(
        home.continueLearning.toReview.items.some(
          (item) => item.id === learningSong.id,
        ),
      ).toBe(false);
    });
  });
});
