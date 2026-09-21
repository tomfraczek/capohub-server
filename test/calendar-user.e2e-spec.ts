/**
 * E2E tests for GET /users/me/calendar - the User Calendar aggregator (see
 * src/calendar/calendar.service.ts). Covers: Section-membership-based
 * Training visibility (regardless of RSVP), participation-based Event
 * visibility (never a PUBLIC Event merely visible-but-unregistered),
 * multiple Sections/Events, CANCELLED staying visible, deterministic
 * ordering, and the from/to range rules (intersection, invalid range, max
 * range).
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

const OWNER_TOKEN = 'valid-calendar-user-owner-token';
const MEMBER_TOKEN = 'valid-calendar-user-member-token';

const OWNER_CLERK_ID = 'user_test_calendar_user_owner';
const MEMBER_CLERK_ID = 'user_test_calendar_user_member';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_calendar_user_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_calendar_user_owner' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_calendar_user_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_calendar_user_member' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/calendar-user-owner.png',
    primaryEmailAddress: { emailAddress: 'calendar.user.owner@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/calendar-user-member.png',
    primaryEmailAddress: { emailAddress: 'calendar.user.member@example.com' },
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

describe('Calendar - User (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  // Separate from createdGroupIds - a User-organized Event has no
  // Group/Section at all (see event-community.util.ts), so it is never
  // reachable through the community-scoped cleanup filters below (same
  // convention as events.e2e-spec.ts).
  const createdPersonalEventIds: string[] = [];
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

      // User-organized Events - cleaned up by their own ids, not by
      // community (they have none). Must run before the User rows below
      // are deleted - same ordering hazard as events.e2e-spec.ts's
      // identical cleanup.
      if (createdPersonalEventIds.length > 0) {
        const eventIsPersonal = { event: { $in: createdPersonalEventIds } };
        await cleanup.nativeDelete(EventAttendee, eventIsPersonal);
        await cleanup.nativeDelete(EventInvitation, eventIsPersonal);
        await cleanup.nativeDelete(EventRoleAssignment, eventIsPersonal);
        await cleanup.nativeDelete(EventStatusHistory, eventIsPersonal);
        await cleanup.nativeDelete(Event, {
          id: { $in: createdPersonalEventIds },
        });
      }

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
      name: 'Calendar User Test Org',
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
      name: 'Calendar User Test Section',
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
      visibility: EventVisibility.PUBLIC,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  async function createPublishedEvent(
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

  // POST /events - creates an Event organized by `token`'s own User,
  // never a Group/Section (see EventsService.createPersonal). The
  // organizer is auto-registered as an attendee and granted OWNER (see
  // finalizeCreate), which is exactly what makes it reachable through
  // EventsService.findForViewerInRange - the same source this calendar
  // already uses, so no separate "personal event" aggregation exists.
  async function createPersonalEvent(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    const created = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${token}`)
        .send(eventPayload(overrides))
        .expect(201),
    );
    createdPersonalEventIds.push(created.id);
    return created;
  }

  async function registerSelf(token: string, eventId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/register`)
      .set('Authorization', `Bearer ${token}`)
      .send({ attendSelf: true })
      .expect(201);
  }

  function getCalendar(
    token: string,
    range: { from: string; to: string },
  ): Promise<CalendarResponseDto> {
    return bodyOf<CalendarResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/calendar')
        .query(range)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  const FULL_RANGE = {
    from: '2031-06-01T00:00:00.000Z',
    to: '2031-06-30T00:00:00.000Z',
  };

  it('includes a Training from my own Section without any RSVP', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const mySection = await createSection(OWNER_TOKEN, group.id);
    await addSectionMember(OWNER_TOKEN, mySection.id, MEMBER_TOKEN);
    const training = await createTraining(OWNER_TOKEN, mySection.id, {
      startsAt: '2031-06-05T18:00:00.000Z',
      endsAt: '2031-06-05T20:00:00.000Z',
    });

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);

    expect(calendar.items.map((item) => item.sourceId)).toContain(training.id);
    const item = calendar.items.find((item) => item.sourceId === training.id);
    expect(item?.type).toBe('TRAINING');
  });

  it('never includes a PUBLIC Training from a Section I am not a member of', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const foreignSection = await createSection(OWNER_TOKEN, group.id, {
      name: 'Foreign Section',
    });
    const training = await createTraining(OWNER_TOKEN, foreignSection.id, {
      visibility: TrainingVisibility.PUBLIC,
      startsAt: '2031-06-06T18:00:00.000Z',
      endsAt: '2031-06-06T20:00:00.000Z',
    });

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);

    expect(calendar.items.map((item) => item.sourceId)).not.toContain(
      training.id,
    );
  });

  it('includes an Event I actually registered for', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const event = await createPublishedEvent(OWNER_TOKEN, group.id, {
      startsAt: '2031-06-07T10:00:00.000Z',
      endsAt: '2031-06-07T12:00:00.000Z',
    });
    await registerSelf(MEMBER_TOKEN, event.id);

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);

    const item = calendar.items.find((item) => item.sourceId === event.id);
    expect(item).toBeDefined();
    expect(item?.type).toBe('EVENT');
    if (item?.type === 'EVENT') {
      expect(item.viewerRsvp).toBe('GOING');
    }
  });

  it('includes a personal Event I organize myself, with no Community at all', async () => {
    const event = await createPersonalEvent(MEMBER_TOKEN, {
      startsAt: '2031-06-17T10:00:00.000Z',
      endsAt: '2031-06-17T12:00:00.000Z',
    });

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);

    const item = calendar.items.find((item) => item.sourceId === event.id);
    expect(item).toBeDefined();
    expect(item?.type).toBe('EVENT');
    if (item?.type === 'EVENT') {
      expect(item.community).toBeNull();
    }
  });

  it("never includes another user's personal Event", async () => {
    const event = await createPersonalEvent(OWNER_TOKEN, {
      startsAt: '2031-06-18T10:00:00.000Z',
      endsAt: '2031-06-18T12:00:00.000Z',
    });

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);

    expect(calendar.items.map((item) => item.sourceId)).not.toContain(
      event.id,
    );
  });

  it('never includes a PUBLIC Event I never registered for, even though I could see it', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const event = await createPublishedEvent(OWNER_TOKEN, group.id, {
      startsAt: '2031-06-08T10:00:00.000Z',
      endsAt: '2031-06-08T12:00:00.000Z',
    });

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);

    expect(calendar.items.map((item) => item.sourceId)).not.toContain(event.id);
  });

  it('keeps a CANCELLED Training visible, marked isCancelled', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const mySection = await createSection(OWNER_TOKEN, group.id, {
      name: 'Cancelled Fixture Section',
    });
    await addSectionMember(OWNER_TOKEN, mySection.id, MEMBER_TOKEN);
    const training = await createTraining(OWNER_TOKEN, mySection.id, {
      startsAt: '2031-06-09T18:00:00.000Z',
      endsAt: '2031-06-09T20:00:00.000Z',
    });
    await cancelTraining(OWNER_TOKEN, mySection.id, training.id);

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);

    const item = calendar.items.find((item) => item.sourceId === training.id);
    expect(item?.isCancelled).toBe(true);
  });

  it('returns items sorted by startsAt ascending across multiple Sections and Events', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const sectionA = await createSection(OWNER_TOKEN, group.id, {
      name: 'Order Section A',
    });
    const sectionB = await createSection(OWNER_TOKEN, group.id, {
      name: 'Order Section B',
    });
    await addSectionMember(OWNER_TOKEN, sectionA.id, MEMBER_TOKEN);
    await addSectionMember(OWNER_TOKEN, sectionB.id, MEMBER_TOKEN);

    const later = await createTraining(OWNER_TOKEN, sectionA.id, {
      startsAt: '2031-06-20T18:00:00.000Z',
      endsAt: '2031-06-20T20:00:00.000Z',
    });
    const earliest = await createTraining(OWNER_TOKEN, sectionB.id, {
      startsAt: '2031-06-11T18:00:00.000Z',
      endsAt: '2031-06-11T20:00:00.000Z',
    });
    const event = await createPublishedEvent(OWNER_TOKEN, group.id, {
      startsAt: '2031-06-15T10:00:00.000Z',
      endsAt: '2031-06-15T12:00:00.000Z',
    });
    await registerSelf(MEMBER_TOKEN, event.id);

    const calendar = await getCalendar(MEMBER_TOKEN, FULL_RANGE);
    const orderedSourceIds = calendar.items
      .map((item) => item.sourceId)
      .filter((id) => [earliest.id, event.id, later.id].includes(id));

    expect(orderedSourceIds).toEqual([earliest.id, event.id, later.id]);
  });

  it('includes an item that starts before `from` but ends after it (range intersection)', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const mySection = await createSection(OWNER_TOKEN, group.id, {
      name: 'Boundary Section',
    });
    await addSectionMember(OWNER_TOKEN, mySection.id, MEMBER_TOKEN);
    const crossing = await createTraining(OWNER_TOKEN, mySection.id, {
      startsAt: '2031-06-13T23:00:00.000Z',
      endsAt: '2031-06-14T01:00:00.000Z',
    });

    const calendar = await getCalendar(MEMBER_TOKEN, {
      from: '2031-06-14T00:00:00.000Z',
      to: '2031-06-14T02:00:00.000Z',
    });

    expect(calendar.items.map((item) => item.sourceId)).toContain(crossing.id);
  });

  it('excludes items entirely outside the requested range', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const mySection = await createSection(OWNER_TOKEN, group.id, {
      name: 'Outside Range Section',
    });
    await addSectionMember(OWNER_TOKEN, mySection.id, MEMBER_TOKEN);
    const training = await createTraining(OWNER_TOKEN, mySection.id, {
      startsAt: '2031-06-05T18:00:00.000Z',
      endsAt: '2031-06-05T20:00:00.000Z',
    });

    const calendar = await getCalendar(MEMBER_TOKEN, {
      from: '2031-06-01T00:00:00.000Z',
      to: '2031-06-02T00:00:00.000Z',
    });

    expect(calendar.items.map((item) => item.sourceId)).not.toContain(
      training.id,
    );
  });

  it('rejects from >= to with 400', async () => {
    const error = await bodyOf<HttpErrorResponse>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/calendar')
        .query({
          from: '2031-06-10T00:00:00.000Z',
          to: '2031-06-01T00:00:00.000Z',
        })
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(400),
    );
    expect(error.statusCode).toBe(400);
  });

  it('rejects a range spanning more than ~1 year', async () => {
    const error = await bodyOf<HttpErrorResponse>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/calendar')
        .query({
          from: '2020-01-01T00:00:00.000Z',
          to: '2031-06-01T00:00:00.000Z',
        })
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(400),
    );
    expect(error.statusCode).toBe(400);
  });

  it('returns 401 for an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/me/calendar')
      .query(FULL_RANGE)
      .expect(401);
  });
});
