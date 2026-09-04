/**
 * E2E tests for GET /groups/:groupId/calendar and
 * GET /sections/:sectionId/calendar - the Community Calendar aggregator
 * (see src/calendar/calendar.service.ts). Covers: exact-community
 * scoping (no parent Group / no sibling Section / no child Section
 * inheritance), PUBLIC vs MEMBERS_ONLY Training access, CANCELLED staying
 * visible, and the route-kind IDOR guard (a Group id must never resolve
 * through the Section route or vice versa).
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
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';
import { Training } from '../src/trainings/entities/training.entity';
import { TrainingRsvp } from '../src/trainings/entities/training-rsvp.entity';
import { TrainingResponseDto } from '../src/trainings/dto/training-response.dto';
import { TrainingVisibility } from '../src/trainings/enums/training-visibility.enum';
import { CalendarResponseDto } from '../src/calendar/dto/calendar-item.dto';

const OWNER_TOKEN = 'valid-calendar-community-owner-token';
const MEMBER_TOKEN = 'valid-calendar-community-member-token';
const OUTSIDER_TOKEN = 'valid-calendar-community-outsider-token';

const OWNER_CLERK_ID = 'user_test_calendar_community_owner';
const MEMBER_CLERK_ID = 'user_test_calendar_community_member';
const OUTSIDER_CLERK_ID = 'user_test_calendar_community_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_calendar_community_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_calendar_community_owner' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_calendar_community_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_calendar_community_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_calendar_community_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_calendar_community_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/calendar-community-owner.png',
    primaryEmailAddress: {
      emailAddress: 'calendar.community.owner@example.com',
    },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/calendar-community-member.png',
    primaryEmailAddress: {
      emailAddress: 'calendar.community.member@example.com',
    },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/calendar-community-outsider.png',
    primaryEmailAddress: {
      emailAddress: 'calendar.community.outsider@example.com',
    },
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

describe('Calendar - Community (e2e)', () => {
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
      const eventInCommunity = {
        event: {
          $or: [
            { communityGroup: { $in: createdGroupIds } },
            { communitySection: { $in: createdGroupIds } },
          ],
        },
      };
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
      await cleanup.nativeDelete(TrainingRsvp, {
        training: { section: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(Training, {
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
      await cleanup.nativeUpdate(
        Group,
        { id: { $in: createdGroupIds } },
        { parentGroup: null },
      );
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function groupPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Calendar Community Test Org',
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

  function sectionPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Calendar Community Test Section',
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
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken) })
      .expect(201);
  }

  function trainingPayload(overrides: Record<string, unknown> = {}) {
    return {
      startsAt: '2031-06-02T18:00:00.000Z',
      endsAt: '2031-06-02T20:00:00.000Z',
      locationName: 'Dojo',
      locationAddress: null,
      latitude: null,
      longitude: null,
      trainerUserId: localUserIdByToken.get(OWNER_TOKEN),
      description: 'Regular training',
      visibility: TrainingVisibility.MEMBERS_ONLY,
      allowExternalRsvp: false,
      ...overrides,
    };
  }

  async function createTraining(
    token: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<TrainingResponseDto> {
    return bodyOf<TrainingResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/trainings`)
        .set('Authorization', `Bearer ${token}`)
        .send(trainingPayload(overrides))
        .expect(201),
    );
  }

  async function cancelTraining(
    token: string,
    sectionId: string,
    trainingId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/trainings/${trainingId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'THIS', reason: null })
      .expect(201);
  }

  function eventPayload(overrides: Record<string, unknown> = {}) {
    return {
      type: 'WORKSHOP',
      customTypeLabel: null,
      name: 'Roda de Sábado',
      description: 'A monthly roda',
      coverImageUrl: null,
      startsAt: '2031-06-10T10:00:00.000Z',
      endsAt: '2031-06-10T18:00:00.000Z',
      locationName: 'Main hall',
      locationAddress: null,
      latitude: null,
      longitude: null,
      visibility: EventVisibility.PUBLIC,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  async function createPublishedEvent(
    token: string,
    communityPath: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    const created = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(communityPath)
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

  function getSectionCalendar(
    token: string,
    sectionId: string,
    range: { from: string; to: string } = FULL_RANGE,
  ): Promise<CalendarResponseDto> {
    return bodyOf<CalendarResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/sections/${sectionId}/calendar`)
        .query(range)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  function getGroupCalendar(
    token: string,
    groupId: string,
    range: { from: string; to: string } = FULL_RANGE,
  ): Promise<CalendarResponseDto> {
    return bodyOf<CalendarResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${groupId}/calendar`)
        .query(range)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  const FULL_RANGE = {
    from: '2031-06-01T00:00:00.000Z',
    to: '2031-06-30T00:00:00.000Z',
  };

  describe('Section calendar', () => {
    it('includes Trainings and Events belonging exactly to this Section', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id);
      const training = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.PUBLIC,
        startsAt: '2031-06-05T18:00:00.000Z',
        endsAt: '2031-06-05T20:00:00.000Z',
      });
      const event = await createPublishedEvent(
        OWNER_TOKEN,
        `/api/v1/sections/${section.id}/events`,
        {
          startsAt: '2031-06-06T10:00:00.000Z',
          endsAt: '2031-06-06T12:00:00.000Z',
        },
      );

      const calendar = await getSectionCalendar(OWNER_TOKEN, section.id);

      const sourceIds = calendar.items.map((item) => item.sourceId);
      expect(sourceIds).toContain(training.id);
      expect(sourceIds).toContain(event.id);
    });

    it("never includes the parent Group's own Event", async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id);
      const groupEvent = await createPublishedEvent(
        OWNER_TOKEN,
        `/api/v1/groups/${group.id}/events`,
      );

      const calendar = await getSectionCalendar(OWNER_TOKEN, section.id);

      expect(calendar.items.map((item) => item.sourceId)).not.toContain(
        groupEvent.id,
      );
    });

    it("never includes a sibling Section's Training or Event", async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        name: 'Sibling Test Section A',
      });
      const sibling = await createSection(OWNER_TOKEN, group.id, {
        name: 'Sibling Test Section B',
      });
      const siblingTraining = await createTraining(OWNER_TOKEN, sibling.id, {
        visibility: TrainingVisibility.PUBLIC,
      });
      const siblingEvent = await createPublishedEvent(
        OWNER_TOKEN,
        `/api/v1/sections/${sibling.id}/events`,
      );

      const calendar = await getSectionCalendar(OWNER_TOKEN, section.id);

      const sourceIds = calendar.items.map((item) => item.sourceId);
      expect(sourceIds).not.toContain(siblingTraining.id);
      expect(sourceIds).not.toContain(siblingEvent.id);
    });

    it('lets a non-member see a PUBLIC Training but not a MEMBERS_ONLY one, and lets a member see both', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        name: 'Access Rules Section',
      });
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
      const publicTraining = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.PUBLIC,
        startsAt: '2031-06-05T18:00:00.000Z',
        endsAt: '2031-06-05T20:00:00.000Z',
      });
      const privateTraining = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.MEMBERS_ONLY,
        startsAt: '2031-06-06T18:00:00.000Z',
        endsAt: '2031-06-06T20:00:00.000Z',
      });

      const outsiderCalendar = await getSectionCalendar(
        OUTSIDER_TOKEN,
        section.id,
      );
      const outsiderIds = outsiderCalendar.items.map((item) => item.sourceId);
      expect(outsiderIds).toContain(publicTraining.id);
      expect(outsiderIds).not.toContain(privateTraining.id);

      const memberCalendar = await getSectionCalendar(MEMBER_TOKEN, section.id);
      const memberIds = memberCalendar.items.map((item) => item.sourceId);
      expect(memberIds).toContain(publicTraining.id);
      expect(memberIds).toContain(privateTraining.id);
    });

    it('keeps a CANCELLED Training visible, marked isCancelled', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        name: 'Cancelled Section Fixture',
      });
      const training = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.PUBLIC,
      });
      await cancelTraining(OWNER_TOKEN, section.id, training.id);

      const calendar = await getSectionCalendar(OWNER_TOKEN, section.id);

      const item = calendar.items.find((item) => item.sourceId === training.id);
      expect(item?.isCancelled).toBe(true);
    });
  });

  describe('Group calendar', () => {
    it('includes Events belonging exactly to this Group', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createPublishedEvent(
        OWNER_TOKEN,
        `/api/v1/groups/${group.id}/events`,
      );

      const calendar = await getGroupCalendar(OWNER_TOKEN, group.id);

      expect(calendar.items.map((item) => item.sourceId)).toContain(event.id);
      expect(calendar.items.every((item) => item.type === 'EVENT')).toBe(true);
    });

    it("never includes a child Section's Training (a Group owns no Training)", async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id);
      await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.PUBLIC,
      });

      const calendar = await getGroupCalendar(OWNER_TOKEN, group.id);

      expect(calendar.items.some((item) => item.type === 'TRAINING')).toBe(
        false,
      );
    });

    it("never includes a child Section's own Event", async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id);
      const sectionEvent = await createPublishedEvent(
        OWNER_TOKEN,
        `/api/v1/sections/${section.id}/events`,
      );

      const calendar = await getGroupCalendar(OWNER_TOKEN, group.id);

      expect(calendar.items.map((item) => item.sourceId)).not.toContain(
        sectionEvent.id,
      );
    });
  });

  describe('route-kind IDOR guard', () => {
    it('404s when a real Group id is used on the Section calendar route', async () => {
      const group = await createGroup(OWNER_TOKEN);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${group.id}/calendar`)
          .query(FULL_RANGE)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('SECTION_NOT_FOUND');
    });

    it('404s when a real Section id is used on the Group calendar route', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${section.id}/calendar`)
          .query(FULL_RANGE)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('GROUP_NOT_FOUND');
    });

    it('returns 401 for an unauthenticated request', async () => {
      const group = await createGroup(OWNER_TOKEN);
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${group.id}/calendar`)
        .query(FULL_RANGE)
        .expect(401);
    });
  });
});
