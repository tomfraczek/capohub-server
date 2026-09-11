/**
 * E2E tests for GET /home (mobile Home screen aggregate).
 *
 * Scenarios:
 *  1. Unauthenticated request -> 401
 *  2. Brand new user -> greetingName derived from their email, every
 *     section in its documented empty state
 *  3. The soonest upcoming Event (any type) becomes nearestEvent; the
 *     soonest upcoming, visible, SCHEDULED Training (a distinct entity
 *     from Event - see trainings/entities/training.entity.ts) becomes
 *     nearestTraining, resolved independently by TrainingsService
 *  4. continueLearning.toReview only ever contains TO_REVIEW rows
 *  5. announcements.items reuses AnnouncementsService's own visibility/
 *     sorting rule, capped at 3, with a correct cross-community
 *     unreadCount; a deleted or naturally-expired Announcement never
 *     appears and never contributes to unreadCount; the response never
 *     carries a `birthdays` or `continueLearning.lastActive` field -
 *     neither has a real backing module in this codebase (see
 *     home-response.dto.ts)
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
import { GlobalRole } from '../src/auth/permissions/global-role.enum';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { closeE2eApp } from './close-e2e-app.helper';
import { HomeResponseDto } from '../src/home/dto/home-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { TrainingResponseDto } from '../src/trainings/dto/training-response.dto';
import { Training } from '../src/trainings/entities/training.entity';
import { TrainingAttendance } from '../src/trainings/entities/training-attendance.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { TrainingRsvp } from '../src/trainings/entities/training-rsvp.entity';
import { TrainingSeries } from '../src/trainings/entities/training-series.entity';
import { TrainingVisibility } from '../src/trainings/enums/training-visibility.enum';
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
import { Announcement } from '../src/announcements/entities/announcement.entity';
import { AnnouncementRead } from '../src/announcements/entities/announcement-read.entity';

const OWNER_TOKEN = 'valid-home-owner-token';
const MEMBER_TOKEN = 'valid-home-member-token';
const NEWUSER_TOKEN = 'valid-home-newuser-token';
// Dedicated to the cross-community unreadCount test below - never added to
// any other group in this file, so its unreadCount can be asserted exactly
// rather than with a loose lower bound (see MEMBER_TOKEN's own
// toBeGreaterThanOrEqual, needed because it accumulates memberships across
// every other test in the 'announcements' describe block).
const MULTI_ORG_TOKEN = 'valid-home-multi-org-token';
// Dedicated to the nearestTraining tests below, for the same reason as
// MULTI_ORG_TOKEN - MEMBER_TOKEN accumulates Section memberships across
// every other test in this file, which would make "the soonest Training"
// and "cancelled is ignored" assertions depend on unrelated tests' data.
const TRAINING_MEMBER_TOKEN = 'valid-home-training-member-token';
const TRAINING_MEMBER_TOKEN_2 = 'valid-home-training-member-2-token';

const OWNER_CLERK_ID = 'user_test_home_owner';
const MEMBER_CLERK_ID = 'user_test_home_member';
const NEWUSER_CLERK_ID = 'user_test_home_newuser';
const MULTI_ORG_CLERK_ID = 'user_test_home_multi_org';
const TRAINING_MEMBER_CLERK_ID = 'user_test_home_training_member';
const TRAINING_MEMBER_CLERK_ID_2 = 'user_test_home_training_member_2';

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
  [MULTI_ORG_TOKEN]: {
    userId: MULTI_ORG_CLERK_ID,
    sessionId: 'sess_home_multi_org',
    tokenType: 'session_token',
    claims: { sub: MULTI_ORG_CLERK_ID, sid: 'sess_home_multi_org' },
  },
  [TRAINING_MEMBER_TOKEN]: {
    userId: TRAINING_MEMBER_CLERK_ID,
    sessionId: 'sess_home_training_member',
    tokenType: 'session_token',
    claims: { sub: TRAINING_MEMBER_CLERK_ID, sid: 'sess_home_training_member' },
  },
  [TRAINING_MEMBER_TOKEN_2]: {
    userId: TRAINING_MEMBER_CLERK_ID_2,
    sessionId: 'sess_home_training_member_2',
    tokenType: 'session_token',
    claims: {
      sub: TRAINING_MEMBER_CLERK_ID_2,
      sid: 'sess_home_training_member_2',
    },
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
  [MULTI_ORG_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/home-multi-org.png',
    primaryEmailAddress: { emailAddress: 'home.multi.org@example.com' },
  },
  [TRAINING_MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/home-training-member.png',
    primaryEmailAddress: { emailAddress: 'home.training.member@example.com' },
  },
  [TRAINING_MEMBER_CLERK_ID_2]: {
    imageUrl: 'https://img.clerk.com/home-training-member-2.png',
    primaryEmailAddress: { emailAddress: 'home.training.member.2@example.com' },
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

    // MEMBER_TOKEN creates songs as fixture data for the continueLearning
    // tests, which requires SONG_CREATE (EDITOR+, a globalRole - see
    // role-permissions.map.ts). Independent of every GroupRole this token
    // also holds elsewhere in this file - this file is about the Home
    // dashboard, not Songs moderation, so the elevation is fixture setup
    // only.
    const memberAuth = TOKEN_TO_AUTH[MEMBER_TOKEN];
    const memberUser = await em.findOneOrFail(User, {
      clerkUserId: memberAuth.userId,
    });
    memberUser.globalRole = GlobalRole.EDITOR;
    await em.flush();
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(Song, { category: category.id });
      await cleanup.nativeDelete(SongCategory, { id: category.id });
      const eventInCommunity = {
        event: {
          $or: [
            { communityGroup: { $in: createdGroupIds } },
            { communitySection: { $in: createdGroupIds } },
          ],
        },
      };
      await cleanup.nativeDelete(EventGuardianAssignment, eventInCommunity);
      await cleanup.nativeDelete(EventAttendee, eventInCommunity);
      await cleanup.nativeDelete(EventInvitation, eventInCommunity);
      await cleanup.nativeDelete(EventRoleAssignment, eventInCommunity);
      await cleanup.nativeDelete(EventStatusHistory, eventInCommunity);
      await cleanup.nativeDelete(Event, {
        $or: [
          { communityGroup: { $in: createdGroupIds } },
          { communitySection: { $in: createdGroupIds } },
        ],
      });
      const announcementCommunityInIds = {
        $or: [
          { communityGroup: { $in: createdGroupIds } },
          { communitySection: { $in: createdGroupIds } },
        ],
      };
      await cleanup.nativeDelete(AnnouncementRead, {
        announcement: announcementCommunityInIds,
      });
      await cleanup.nativeDelete(Announcement, announcementCommunityInIds);
      await cleanup.nativeDelete(Notification, {
        $or: [
          { contextGroup: { $in: createdGroupIds } },
          { contextSection: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(TrainingAttendance, {
        training: { section: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(TrainingRsvp, {
        training: { section: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(Training, {
        section: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(TrainingSeries, {
        section: { $in: createdGroupIds },
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

  // Group has no membership/MEMBER role at all (see the Membership/
  // RoleAssignments rebuild) - the only way to associate another user with
  // a Group is a direct ADMIN grant, which is also sufficient for
  // `isCommunityMember`/COMMUNITY_MEMBERS visibility (any held
  // RoleAssignment counts - see RoleAssignmentsService.isCommunityMember).
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
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberUser.id, role: GroupRole.ADMIN })
      .expect(201);
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Home Test Section',
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
      ...overrides,
    };
  }

  async function createSection(
    token: string,
    parentGroupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function addSectionMember(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
  ): Promise<void> {
    const memberUser = await bodyOf<{ id: string }>(
      request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberUser.id })
      .expect(201);
  }

  async function createTraining(
    token: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<TrainingResponseDto> {
    const trainerUser = await bodyOf<{ id: string }>(
      request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
    return bodyOf<TrainingResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/trainings`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          startsAt: '2031-01-05T10:00:00.000Z',
          endsAt: '2031-01-05T12:00:00.000Z',
          locationName: null,
          locationAddress: null,
          latitude: null,
          longitude: null,
          trainerUserId: trainerUser.id,
          description: null,
          visibility: TrainingVisibility.MEMBERS_ONLY,
          ...overrides,
        })
        .expect(201),
    );
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
              position: 1,
              phonetics: [],
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
    expect(home.announcements).toEqual({ items: [], unreadCount: 0 });
    expect(home).not.toHaveProperty('birthdays');
  });

  describe('nearestEvent / nearestTraining', () => {
    it('the soonest upcoming Event of any type becomes nearestEvent, independent of Trainings', async () => {
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
      await createAndPublishEvent(OWNER_TOKEN, group.id, {
        type: 'OPEN_RODA',
        name: 'Later Roda',
        startsAt: '2031-03-01T10:00:00.000Z',
        endsAt: '2031-03-01T12:00:00.000Z',
      });

      const home = await getHome(MEMBER_TOKEN);

      expect(home.nearestEvent?.id).toBe(soonerWorkshop.id);
    });

    it('the soonest upcoming, visible, SCHEDULED Training for a Section the caller is an active member of becomes nearestTraining', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Home Trainings Org',
      });
      const section = await createSection(OWNER_TOKEN, group.id, {
        name: 'Home Trainings Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, TRAINING_MEMBER_TOKEN);

      await createTraining(OWNER_TOKEN, section.id, {
        startsAt: '2031-04-10T10:00:00.000Z',
        endsAt: '2031-04-10T12:00:00.000Z',
      });
      const soonerTraining = await createTraining(OWNER_TOKEN, section.id, {
        startsAt: '2031-04-05T10:00:00.000Z',
        endsAt: '2031-04-05T12:00:00.000Z',
      });

      const home = await getHome(TRAINING_MEMBER_TOKEN);

      expect(home.nearestTraining?.id).toBe(soonerTraining.id);
    });

    it('a cancelled Training is never returned as nearestTraining', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Home Cancelled Training Org',
      });
      const section = await createSection(OWNER_TOKEN, group.id, {
        name: 'Home Cancelled Training Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, TRAINING_MEMBER_TOKEN_2);

      const training = await createTraining(OWNER_TOKEN, section.id, {
        startsAt: '2031-05-01T10:00:00.000Z',
        endsAt: '2031-05-01T12:00:00.000Z',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings/${training.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ scope: 'THIS', reason: null })
        .expect(201);

      const home = await getHome(TRAINING_MEMBER_TOKEN_2);

      expect(home.nearestTraining).toBeNull();
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

  describe('announcements', () => {
    function announcementPayload(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        title: 'Home test announcement',
        body: 'Body',
        isPinned: false,
        expiresAt: '2031-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    async function createAnnouncement(
      token: string,
      groupId: string,
      overrides: Record<string, unknown> = {},
    ) {
      return bodyOf<{ id: string }>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${groupId}/announcements`)
          .set('Authorization', `Bearer ${token}`)
          .send(announcementPayload(overrides))
          .expect(201),
      );
    }

    it('reuses AnnouncementsService visibility/sorting: at most 3 active items, newest/pinned first, with a correct unreadCount', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Home Announcements Org',
      });
      await addMember(OWNER_TOKEN, group.id, MEMBER_TOKEN);

      // Oldest unpinned - must fall out of the capped (limit 3) preview,
      // even though it is still an active, visible Announcement.
      const oldest = await createAnnouncement(OWNER_TOKEN, group.id, {
        title: 'Oldest',
      });
      const pinned = await createAnnouncement(OWNER_TOKEN, group.id, {
        title: 'Pinned',
        isPinned: true,
      });
      const newer = await createAnnouncement(OWNER_TOKEN, group.id, {
        title: 'Newer',
      });
      const newest = await createAnnouncement(OWNER_TOKEN, group.id, {
        title: 'Newest',
      });

      const home = await getHome(MEMBER_TOKEN);

      expect(home.announcements.items).toHaveLength(3);
      expect(home.announcements.items.map((item) => item.id)).toEqual([
        pinned.id,
        newest.id,
        newer.id,
      ]);
      expect(
        home.announcements.items.some((item) => item.id === oldest.id),
      ).toBe(false);
      expect(home.announcements.unreadCount).toBeGreaterThanOrEqual(4);
      expect(home.announcements.items[0].communityResourceType).toBe('GROUP');

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/announcements/${oldest.id}/read`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const homeAfterRead = await getHome(MEMBER_TOKEN);
      expect(homeAfterRead.announcements.unreadCount).toBe(
        home.announcements.unreadCount - 1,
      );
    });

    it('unreadCount reflects the full cross-community visible set, not just the capped 3-item preview', async () => {
      const orgA = await createGroup(OWNER_TOKEN, {
        name: 'Home Multi-Org A',
      });
      const orgB = await createGroup(OWNER_TOKEN, {
        name: 'Home Multi-Org B',
      });
      await addMember(OWNER_TOKEN, orgA.id, MULTI_ORG_TOKEN);
      await addMember(OWNER_TOKEN, orgB.id, MULTI_ORG_TOKEN);

      // 3 in org A, 2 in org B - 5 total visible, but the preview caps at 3.
      await createAnnouncement(OWNER_TOKEN, orgA.id, { title: 'A1' });
      await createAnnouncement(OWNER_TOKEN, orgA.id, { title: 'A2' });
      await createAnnouncement(OWNER_TOKEN, orgA.id, { title: 'A3' });
      await createAnnouncement(OWNER_TOKEN, orgB.id, { title: 'B1' });
      await createAnnouncement(OWNER_TOKEN, orgB.id, { title: 'B2' });

      const home = await getHome(MULTI_ORG_TOKEN);

      expect(home.announcements.items).toHaveLength(3);
      expect(home.announcements.unreadCount).toBe(5);
    });

    it('never includes a deleted or naturally-expired Announcement, and neither contributes to unreadCount', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: 'Home Announcements Lifecycle Org',
      });
      await addMember(OWNER_TOKEN, group.id, MEMBER_TOKEN);

      const baseline = await getHome(MEMBER_TOKEN);

      const toDelete = await createAnnouncement(OWNER_TOKEN, group.id, {
        title: 'Will be deleted',
      });
      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${group.id}/announcements/${toDelete.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const toExpire = await createAnnouncement(OWNER_TOKEN, group.id, {
        title: 'Will expire',
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      });
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const home = await getHome(MEMBER_TOKEN);

      expect(
        home.announcements.items.some((item) => item.id === toDelete.id),
      ).toBe(false);
      expect(
        home.announcements.items.some((item) => item.id === toExpire.id),
      ).toBe(false);
      expect(home.announcements.unreadCount).toBe(
        baseline.announcements.unreadCount,
      );
    });
  });
});
