/**
 * E2E tests for Event Attendance (module spec: EventAttendance + numericCode/
 * QR check-in): GET/PUT /events/:eventId/attendance and
 * POST /events/:eventId/check-in. No separate EventAttendance table exists -
 * this reuses EventAttendee.checkedIn/checkedInAt/checkedInBy/checkInMethod
 * (see event-attendance.service.ts).
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
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import {
  EventAttendanceEntryDto,
  EventAttendanceIdentifyResponseDto,
  EventAttendanceRosterResponseDto,
  EventCheckInResultDto,
} from '../src/events/dto/event-attendance.dto';
import { EventAttendeeResponseDto } from '../src/events/dto/event-attendee-response.dto';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventGuardianAssignment } from '../src/events/entities/event-guardian-assignment.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventAttendeeSubjectType } from '../src/events/enums/event-attendee-subject-type.enum';
import { EventRole } from '../src/events/enums/event-role.enum';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';

const OWNER_TOKEN = 'valid-event-attendance-owner-token';
const ORGANIZER_TOKEN = 'valid-event-attendance-organizer-token';
const MODERATOR_TOKEN = 'valid-event-attendance-moderator-token';
const OUTSIDER_TOKEN = 'valid-event-attendance-outsider-token';
const ATTENDEE_TOKEN = 'valid-event-attendance-attendee-token';
const ATTENDEE2_TOKEN = 'valid-event-attendance-attendee2-token';
const NON_ATTENDEE_TOKEN = 'valid-event-attendance-non-attendee-token';

const CLERK_IDS: Record<string, string> = {
  [OWNER_TOKEN]: 'user_test_evt_att_owner',
  [ORGANIZER_TOKEN]: 'user_test_evt_att_organizer',
  [MODERATOR_TOKEN]: 'user_test_evt_att_moderator',
  [OUTSIDER_TOKEN]: 'user_test_evt_att_outsider',
  [ATTENDEE_TOKEN]: 'user_test_evt_att_attendee',
  [ATTENDEE2_TOKEN]: 'user_test_evt_att_attendee2',
  [NON_ATTENDEE_TOKEN]: 'user_test_evt_att_non_attendee',
};

const TOKEN_TO_AUTH: Record<string, AuthContext> = Object.fromEntries(
  Object.entries(CLERK_IDS).map(([token, clerkUserId]) => [
    token,
    {
      userId: clerkUserId,
      sessionId: `sess_${clerkUserId}`,
      tokenType: 'session_token',
      claims: { sub: clerkUserId, sid: `sess_${clerkUserId}` },
    },
  ]),
);

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = Object.fromEntries(
  Object.values(CLERK_IDS).map((clerkUserId) => [
    clerkUserId,
    {
      imageUrl: `https://img.clerk.com/${clerkUserId}.png`,
      primaryEmailAddress: { emailAddress: `${clerkUserId}@example.com` },
    },
  ]),
);

const TEST_CLERK_USER_IDS = Object.values(CLERK_IDS);

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

describe('Event Attendance (e2e)', () => {
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
      await cleanup.nativeDelete(RoleAssignment, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // Safety net, scoped directly by user id rather than through
      // Event/Group tracking: EventRoleAssignment.user is a non-nullable,
      // `deleteRule: 'no action'` FK (see event-role-assignment.entity.ts),
      // so ANY row still referencing one of this file's fixture users -
      // regardless of which Group/Event it was granted on, or whether the
      // `eventInCommunity`-scoped delete above already caught it - must be
      // cleared before the User delete below, or that delete fails outright
      // with a raw FK violation (observed in practice: some
      // setupStandardFixture()-created Events/Groups were not reliably
      // covered by createdGroupIds at cleanup time). Mirrors
      // UserService.deleteLocalAccountData's own EventRoleAssignment
      // cleanup step for the identical reason.
      await cleanup.nativeDelete(EventRoleAssignment, {
        user: { $in: [...localUserIdByToken.values()] },
      });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function groupPayload(): Record<string, unknown> {
    return {
      name: 'Event Attendance Test Org',
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
    };
  }

  async function createGroup(token: string): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send(groupPayload())
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  // EventRolesService.grantRole requires the target to already be an
  // active member of the Event's Community before it can hold an Event
  // role (see event-roles.service.ts) - granted here as plain Group ADMIN,
  // same precedent as events.e2e-spec.ts's own createCommunityWithMembers.
  async function grantGroupRole(
    ownerToken: string,
    groupId: string,
    memberToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role: 'ADMIN' })
      .expect(201);
  }

  async function grantEventRole(
    ownerToken: string,
    eventId: string,
    memberToken: string,
    role: EventRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/roles`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  function eventPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
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

  /** A published Event that already started - attendance may be recorded. */
  async function createStartedEvent(
    token: string,
    groupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    return createAndPublishEvent(token, groupId, {
      startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      ...overrides,
    });
  }

  async function registerSelf(token: string, eventId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/register`)
      .set('Authorization', `Bearer ${token}`)
      .send({ attendSelf: true })
      .expect(201);
  }

  async function getNumericCode(token: string): Promise<string> {
    const profile = await bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
    return profile.numericCode;
  }

  // Registers a CHILD_DEPENDENT under `token` (the registering
  // parent/guardian) - EventRsvpService.register automatically creates the
  // initial EventGuardianAssignment{guardian: token's User, attendee: the
  // child} in the same call (see event-guardian-assignment.entity.ts's own
  // comment). `attendSelf: false` here means `token` themselves never gets
  // an EventAttendee row - exactly the "guardian with no selfAttendee"
  // fixture shape.
  async function registerChildDependent(
    token: string,
    eventId: string,
    displayName: string,
    attendSelf = false,
  ): Promise<EventAttendeeResponseDto> {
    const attendees = await bodyOf<EventAttendeeResponseDto[]>(
      request(app.getHttpServer())
        .post(`/api/v1/events/${eventId}/register`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          attendSelf,
          children: [{ subjectType: 'CHILD_DEPENDENT', displayName }],
        })
        .expect(201),
    );
    const child = attendees.find(
      (a) => a.subjectType === EventAttendeeSubjectType.CHILD_DEPENDENT,
    );
    if (!child) {
      throw new Error('Expected a CHILD_DEPENDENT attendee in the response');
    }
    return child;
  }

  // ─── setup shared across most tests: one Group, one started Event, OWNER/
  // ORGANIZER/MODERATOR Event roles, one registered attendee ──────────────
  async function setupStandardFixture(): Promise<{
    group: GroupResponseDto;
    event: EventResponseDto;
  }> {
    const group = await createGroup(OWNER_TOKEN);
    await grantGroupRole(OWNER_TOKEN, group.id, ORGANIZER_TOKEN);
    await grantGroupRole(OWNER_TOKEN, group.id, MODERATOR_TOKEN);
    const event = await createStartedEvent(OWNER_TOKEN, group.id);
    await grantEventRole(
      OWNER_TOKEN,
      event.id,
      ORGANIZER_TOKEN,
      EventRole.ORGANIZER,
    );
    await grantEventRole(
      OWNER_TOKEN,
      event.id,
      MODERATOR_TOKEN,
      EventRole.MODERATOR,
    );
    await registerSelf(ATTENDEE_TOKEN, event.id);
    return { group, event };
  }

  describe('PUT /events/:eventId/attendance/:userId', () => {
    it('lets the Event OWNER mark an attendee present, then absent', async () => {
      const { event } = await setupStandardFixture();
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN)!;

      const present = await bodyOf<EventAttendanceEntryDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/${attendeeUserId}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: true })
          .expect(200),
      );
      expect(present.attended).toBe(true);
      expect(present.recordedAt).not.toBeNull();

      const absent = await bodyOf<EventAttendanceEntryDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/${attendeeUserId}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: false })
          .expect(200),
      );
      expect(absent.attended).toBe(false);
    });

    it('lets an ORGANIZER record attendance', async () => {
      const { event } = await setupStandardFixture();
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN)!;

      await request(app.getHttpServer())
        .put(`/api/v1/events/${event.id}/attendance/${attendeeUserId}`)
        .set('Authorization', `Bearer ${ORGANIZER_TOKEN}`)
        .send({ attended: true })
        .expect(200);
    });

    it('rejects an outsider with no Event role - 404 (never confirms the Event exists)', async () => {
      const { event } = await setupStandardFixture();
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN)!;

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/${attendeeUserId}`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .send({ attended: true })
          .expect(404),
      );
      expect(error.code).toBe('EVENT_NOT_FOUND');
    });

    it('rejects a user with no EventAttendee row - EVENT_ATTENDEE_NOT_FOUND', async () => {
      const { event } = await setupStandardFixture();
      const nonAttendeeUserId = localUserIdByToken.get(NON_ATTENDEE_TOKEN)!;

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/${nonAttendeeUserId}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: true })
          .expect(404),
      );
      expect(error.code).toBe('EVENT_ATTENDEE_NOT_FOUND');
    });

    it('rejects before the Event has started', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const futureEvent = await createAndPublishEvent(OWNER_TOKEN, group.id, {
        startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        endsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
      });
      await registerSelf(ATTENDEE_TOKEN, futureEvent.id);
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN)!;

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${futureEvent.id}/attendance/${attendeeUserId}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: true })
          .expect(409),
      );
      expect(error.code).toBe('EVENT_NOT_STARTED');
    });

    it('rejects for a CANCELLED Event', async () => {
      const { event } = await setupStandardFixture();
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN)!;
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ reason: null })
        .expect(201);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/${attendeeUserId}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: true })
          .expect(409),
      );
      expect(error.code).toBe('EVENT_CANCELLED');
    });
  });

  describe('GET /events/:eventId/attendance (roster)', () => {
    it('returns RSVP + attendance for every attendee, safe user refs only', async () => {
      const { event } = await setupStandardFixture();
      await registerSelf(ATTENDEE2_TOKEN, event.id);
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN)!;
      await request(app.getHttpServer())
        .put(`/api/v1/events/${event.id}/attendance/${attendeeUserId}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ attended: true })
        .expect(200);

      const roster = await bodyOf<EventAttendanceRosterResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/attendance`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .expect(200),
      );

      expect(roster.event.id).toBe(event.id);
      expect(roster.items).toHaveLength(2);
      const marked = roster.items.find(
        (item) => item.user.id === attendeeUserId,
      );
      expect(marked?.attended).toBe(true);
      expect(marked?.rsvpStatus).toBe('GOING');
      for (const item of roster.items) {
        expect(Object.keys(item.user).sort()).toEqual(['displayName', 'id']);
      }
    });
  });

  describe('POST /events/:eventId/check-in', () => {
    it('checks in by numericCode, then is idempotent on a second identical scan', async () => {
      const { event } = await setupStandardFixture();
      const code = await getNumericCode(ATTENDEE_TOKEN);

      const first = await bodyOf<EventCheckInResultDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ identity: code })
          .expect(201),
      );
      expect(first.attended).toBe(true);
      expect(first.alreadyCheckedIn).toBe(false);

      const second = await bodyOf<EventCheckInResultDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ identity: code })
          .expect(201),
      );
      expect(second.attended).toBe(true);
      expect(second.alreadyCheckedIn).toBe(true);
    });

    it('checks in by User QR payload', async () => {
      const { event } = await setupStandardFixture();
      const code = await getNumericCode(ATTENDEE_TOKEN);

      const result = await bodyOf<EventCheckInResultDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: `capohub:v1:u:${code}` })
          .expect(201),
      );
      expect(result.attended).toBe(true);
    });

    it('rejects a user with no EventAttendee row', async () => {
      const { event } = await setupStandardFixture();
      const code = await getNumericCode(NON_ATTENDEE_TOKEN);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code })
          .expect(404),
      );
      expect(error.code).toBe('EVENT_ATTENDEE_NOT_FOUND');
    });

    it('rejects an Event QR payload as the check-in identity - WRONG_IDENTITY_TYPE', async () => {
      const { event } = await setupStandardFixture();

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: 'capohub:v1:f:999999' })
          .expect(400),
      );
      expect(error.code).toBe('WRONG_IDENTITY_TYPE');
    });

    it('rejects malformed identity with 400, never 500', async () => {
      const { event } = await setupStandardFixture();

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/check-in`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ identity: 'not-a-real-code' })
        .expect(400);
    });

    it('rejects a caller with no Event role - 404', async () => {
      const { event } = await setupStandardFixture();
      const code = await getNumericCode(ATTENDEE_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/check-in`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ identity: code })
        .expect(404);
    });

    it('two concurrent check-ins of the same user never duplicate or 500 - exactly one logical attendance', async () => {
      const { event } = await setupStandardFixture();
      await registerSelf(ATTENDEE2_TOKEN, event.id);
      const code = await getNumericCode(ATTENDEE2_TOKEN);

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code }),
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ identity: code }),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);

      const roster = await bodyOf<EventAttendanceRosterResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/attendance`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const attendee2UserId = localUserIdByToken.get(ATTENDEE2_TOKEN);
      const matches = roster.items.filter(
        (item) => item.user.id === attendee2UserId,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0].attended).toBe(true);
    });
  });

  describe('POST /events/:eventId/attendance/identify', () => {
    it('returns selfAttendee for a plain attendee with no children', async () => {
      const { event } = await setupStandardFixture();
      const code = await getNumericCode(ATTENDEE_TOKEN);

      const result = await bodyOf<EventAttendanceIdentifyResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/attendance/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code })
          .expect(201),
      );

      expect(result.user.id).toBe(localUserIdByToken.get(ATTENDEE_TOKEN));
      expect(result.selfAttendee).not.toBeNull();
      expect(result.childrenUnderGuardianship).toEqual([]);
    });

    it('returns selfAttendee plus one child under guardianship', async () => {
      const { event } = await setupStandardFixture();
      const child = await registerChildDependent(
        ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        true,
      );
      const code = await getNumericCode(ATTENDEE_TOKEN);

      const result = await bodyOf<EventAttendanceIdentifyResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/attendance/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code })
          .expect(201),
      );

      expect(result.selfAttendee).not.toBeNull();
      expect(result.childrenUnderGuardianship).toHaveLength(1);
      expect(result.childrenUnderGuardianship[0].attendeeId).toBe(child.id);
      expect(result.childrenUnderGuardianship[0].user).toEqual({
        id: null,
        displayName: 'Ania Kowalska',
      });
    });

    it('returns selfAttendee plus several children under guardianship', async () => {
      const { event } = await setupStandardFixture();
      await registerChildDependent(
        ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        true,
      );
      // A second register call for the same guardian, a second child -
      // each call creates its own attendee + its own automatic guardian
      // assignment for the same registering User.
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/register`)
        .set('Authorization', `Bearer ${ATTENDEE_TOKEN}`)
        .send({
          attendSelf: false,
          children: [
            { subjectType: 'CHILD_DEPENDENT', displayName: 'Tomek Kowalski' },
          ],
        })
        .expect(201);
      const code = await getNumericCode(ATTENDEE_TOKEN);

      const result = await bodyOf<EventAttendanceIdentifyResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/attendance/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code })
          .expect(201),
      );

      expect(result.childrenUnderGuardianship).toHaveLength(2);
      const names = result.childrenUnderGuardianship
        .map((c) => c.user.displayName)
        .sort();
      expect(names).toEqual(['Ania Kowalska', 'Tomek Kowalski']);
    });

    it('returns selfAttendee=null plus the child when the guardian is not themselves an attendee', async () => {
      const { event } = await setupStandardFixture();
      const child = await registerChildDependent(
        NON_ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        false,
      );
      const code = await getNumericCode(NON_ATTENDEE_TOKEN);

      const result = await bodyOf<EventAttendanceIdentifyResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/attendance/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code })
          .expect(201),
      );

      expect(result.selfAttendee).toBeNull();
      expect(result.childrenUnderGuardianship).toHaveLength(1);
      expect(result.childrenUnderGuardianship[0].attendeeId).toBe(child.id);
    });

    it('returns EVENT_ATTENDEE_NOT_FOUND when the User has no selfAttendee and no children', async () => {
      const { event } = await setupStandardFixture();
      const code = await getNumericCode(NON_ATTENDEE_TOKEN);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/attendance/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code })
          .expect(404),
      );
      expect(error.code).toBe('EVENT_ATTENDEE_NOT_FOUND');
    });

    it('rejects an Event QR payload as the identify identity - WRONG_IDENTITY_TYPE', async () => {
      const { event } = await setupStandardFixture();

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/attendance/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: 'capohub:v1:f:999999' })
          .expect(400),
      );
      expect(error.code).toBe('WRONG_IDENTITY_TYPE');
    });

    it('rejects malformed identity with 400, never 500', async () => {
      const { event } = await setupStandardFixture();

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/attendance/identify`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ identity: 'not-a-real-code' })
        .expect(400);
    });

    it('rejects a caller with no Event role - 404', async () => {
      const { event } = await setupStandardFixture();
      const code = await getNumericCode(ATTENDEE_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/attendance/identify`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ identity: code })
        .expect(404);
    });

    it('performs zero mutation - checkedIn/checkedInAt are unchanged after identify', async () => {
      const { event } = await setupStandardFixture();
      const child = await registerChildDependent(
        ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        true,
      );
      const code = await getNumericCode(ATTENDEE_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/attendance/identify`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ identity: code })
        .expect(201);

      const roster = await bodyOf<EventAttendanceRosterResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/attendance`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN);
      const selfItem = roster.items.find(
        (item) => item.user.id === attendeeUserId,
      );
      const childItem = roster.items.find(
        (item) => item.attendeeId === child.id,
      );
      expect(selfItem?.attended).toBe(false);
      expect(selfItem?.recordedAt).toBeNull();
      expect(childItem?.attended).toBe(false);
      expect(childItem?.recordedAt).toBeNull();
    });
  });

  describe('self check-in never touches children under guardianship', () => {
    it('checking in the guardian via POST check-in leaves their children untouched', async () => {
      const { event } = await setupStandardFixture();
      const child = await registerChildDependent(
        ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        true,
      );
      const code = await getNumericCode(ATTENDEE_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/check-in`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ identity: code })
        .expect(201);

      const roster = await bodyOf<EventAttendanceRosterResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/attendance`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const attendeeUserId = localUserIdByToken.get(ATTENDEE_TOKEN);
      const selfItem = roster.items.find(
        (item) => item.user.id === attendeeUserId,
      );
      const childItem = roster.items.find(
        (item) => item.attendeeId === child.id,
      );
      expect(selfItem?.attended).toBe(true);
      expect(childItem?.attended).toBe(false);
      expect(childItem?.recordedAt).toBeNull();
    });

    it('rejects check-in for a guardian with no selfAttendee, without guessing a child', async () => {
      const { event } = await setupStandardFixture();
      await registerChildDependent(
        NON_ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        false,
      );
      const code = await getNumericCode(NON_ATTENDEE_TOKEN);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/check-in`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: code })
          .expect(404),
      );
      expect(error.code).toBe('EVENT_ATTENDEE_NOT_FOUND');
    });
  });

  describe('PUT /events/:eventId/attendance/attendees/:attendeeId (CHILD_DEPENDENT)', () => {
    it('marks a CHILD_DEPENDENT attendee present, then explicitly absent', async () => {
      const { event } = await setupStandardFixture();
      const child = await registerChildDependent(
        ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        true,
      );

      const present = await bodyOf<EventAttendanceEntryDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/attendees/${child.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: true })
          .expect(200),
      );
      expect(present.attended).toBe(true);
      expect(present.user).toEqual({ id: null, displayName: 'Ania Kowalska' });

      const absent = await bodyOf<EventAttendanceEntryDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/attendees/${child.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: false })
          .expect(200),
      );
      expect(absent.attended).toBe(false);
      expect(absent.recordedAt).not.toBeNull();
    });

    it('flips false back to true', async () => {
      const { event } = await setupStandardFixture();
      const child = await registerChildDependent(
        ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        true,
      );

      await request(app.getHttpServer())
        .put(`/api/v1/events/${event.id}/attendance/attendees/${child.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ attended: false })
        .expect(200);

      const flipped = await bodyOf<EventAttendanceEntryDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/attendance/attendees/${child.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: true })
          .expect(200),
      );
      expect(flipped.attended).toBe(true);
    });

    it('the roster exposes attendeeId, with no private data leaked for the child', async () => {
      const { event } = await setupStandardFixture();
      const child = await registerChildDependent(
        ATTENDEE_TOKEN,
        event.id,
        'Ania Kowalska',
        true,
      );

      const roster = await bodyOf<EventAttendanceRosterResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/attendance`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const childItem = roster.items.find(
        (item) => item.attendeeId === child.id,
      );
      expect(childItem).toBeDefined();
      expect(Object.keys(childItem!).sort()).toEqual(
        ['attendeeId', 'user', 'rsvpStatus', 'attended', 'recordedAt'].sort(),
      );
      expect(Object.keys(childItem!.user).sort()).toEqual([
        'displayName',
        'id',
      ]);
    });

    it('rejects an unknown attendeeId with EVENT_ATTENDEE_NOT_FOUND', async () => {
      const { event } = await setupStandardFixture();

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(
            `/api/v1/events/${event.id}/attendance/attendees/00000000-0000-0000-0000-000000000000`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ attended: true })
          .expect(404),
      );
      expect(error.code).toBe('EVENT_ATTENDEE_NOT_FOUND');
    });
  });

  it('returns 401 for an unauthenticated request', async () => {
    const { event } = await setupStandardFixture();
    await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}/attendance`)
      .expect(401);
  });
});
