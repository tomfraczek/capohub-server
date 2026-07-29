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
import { User } from '../src/users/entities/user.entity';
import { UserResponseDto } from '../src/users/dto/user-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { EventAttendeeResponseDto } from '../src/events/dto/event-attendee-response.dto';
import { EventRoleAssignmentResponseDto } from '../src/events/dto/event-role-assignment-response.dto';
import { EventStatusHistoryResponseDto } from '../src/events/dto/event-status-history-response.dto';
import { EventGuardianAssignment } from '../src/events/entities/event-guardian-assignment.entity';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventRole } from '../src/events/enums/event-role.enum';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';

const OWNER_TOKEN = 'valid-events-owner-token';
const ORGANIZER_TOKEN = 'valid-events-organizer-token';
const MODERATOR_TOKEN = 'valid-events-moderator-token';
const MEMBER_TOKEN = 'valid-events-member-token';
const OUTSIDER_TOKEN = 'valid-events-outsider-token';

const OWNER_CLERK_ID = 'user_test_events_owner';
const ORGANIZER_CLERK_ID = 'user_test_events_organizer';
const MODERATOR_CLERK_ID = 'user_test_events_moderator';
const MEMBER_CLERK_ID = 'user_test_events_member';
const OUTSIDER_CLERK_ID = 'user_test_events_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_events_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_events_owner' },
  },
  [ORGANIZER_TOKEN]: {
    userId: ORGANIZER_CLERK_ID,
    sessionId: 'sess_events_organizer',
    tokenType: 'session_token',
    claims: { sub: ORGANIZER_CLERK_ID, sid: 'sess_events_organizer' },
  },
  [MODERATOR_TOKEN]: {
    userId: MODERATOR_CLERK_ID,
    sessionId: 'sess_events_moderator',
    tokenType: 'session_token',
    claims: { sub: MODERATOR_CLERK_ID, sid: 'sess_events_moderator' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_events_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_events_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_events_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_events_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-owner.png',
    primaryEmailAddress: { emailAddress: 'events.owner@example.com' },
  },
  [ORGANIZER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-organizer.png',
    primaryEmailAddress: { emailAddress: 'events.organizer@example.com' },
  },
  [MODERATOR_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-moderator.png',
    primaryEmailAddress: { emailAddress: 'events.moderator@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-member.png',
    primaryEmailAddress: { emailAddress: 'events.member@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-outsider.png',
    primaryEmailAddress: { emailAddress: 'events.outsider@example.com' },
  },
};

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    const auth = TOKEN_TO_AUTH[token];
    if (auth) {
      return Promise.resolve(auth);
    }
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

describe('Events (e2e)', () => {
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
    const cleanup = app.get(EntityManager).fork();
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
      name: 'Capoeira Events Test',
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
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        userId: localUserIdByToken.get(memberToken),
        role: GroupRole.MEMBER,
      })
      .expect(201);
  }

  async function createCommunityWithMembers(): Promise<GroupResponseDto> {
    const community = await createGroup(OWNER_TOKEN);
    await addMember(OWNER_TOKEN, community.id, ORGANIZER_TOKEN);
    await addMember(OWNER_TOKEN, community.id, MODERATOR_TOKEN);
    await addMember(OWNER_TOKEN, community.id, MEMBER_TOKEN);
    return community;
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
      startsAt: '2027-01-10T10:00:00.000Z',
      endsAt: '2027-01-10T18:00:00.000Z',
      locationName: 'Main hall',
      locationAddress: null,
      latitude: null,
      longitude: null,
      visibility: EventVisibility.COMMUNITY_MEMBERS,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  async function createEvent(
    token: string,
    groupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    return bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send(eventPayload(overrides))
        .expect(201),
    );
  }

  async function publishEvent(
    token: string,
    eventId: string,
  ): Promise<EventResponseDto> {
    return bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        // No @HttpCode override on this endpoint - NestJS's default POST
        // status (201), not 200 - mirrors POST /groups/:id/archive.
        .expect(201),
    );
  }

  describe('create + community-level permission gate', () => {
    it('lets a Community Admin/Owner create an Event, auto-granting them OWNER', async () => {
      const community = await createCommunityWithMembers();

      const created = await createEvent(OWNER_TOKEN, community.id);

      expect(created.status).toBe('DRAFT');
      expect(created.viewerRoles).toEqual(['OWNER']);
      expect(created.capabilities).toMatchObject({
        canEdit: true,
        canPublish: true,
        canManageOrganizers: true,
        canTransferOwnership: true,
      });
    });

    it('rejects creation by a plain MEMBER - 403 INSUFFICIENT_GROUP_PERMISSIONS', async () => {
      const community = await createCommunityWithMembers();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send(eventPayload())
          .expect(403),
      );
      expect(response.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });

    it('rejects creation by a non-member of the community - 404 GROUP_NOT_FOUND', async () => {
      const community = await createCommunityWithMembers();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .send(eventPayload())
          .expect(404),
      );
      expect(response.code).toBe('GROUP_NOT_FOUND');
    });

    // An Event's Community may be a Group or a Section (event.entity.ts) -
    // EventsController is dual-mounted the same way RoleAssignments/
    // Academies/Cohorts are, so both route families must work identically.
    it('creates and lists an Event under a Section via /api/v1/sections/:sectionId/events', async () => {
      const community = await createCommunityWithMembers();
      const section = await bodyOf<{ id: string }>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            name: 'Section Events Test',
            timezone: 'Europe/Warsaw',
            currencyCode: 'PLN',
            country: 'PL',
          })
          .expect(201),
      );
      // A Section is a Group-kind row too (single self-referencing entity) -
      // must be registered the same as createGroup() does, or afterAll's
      // cleanup skips deleting it and the OWNER RoleAssignment it creates,
      // leaving that RoleAssignment still pointing at the GroupMembership
      // cleanup tries to delete next (FK violation on role_assignments).
      createdGroupIds.push(section.id);

      const created = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(eventPayload({ name: 'Section-scoped Event' }))
          .expect(201),
      );
      expect(created.status).toBe('DRAFT');

      const list = await bodyOf<{ items: EventResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.items.some((event) => event.id === created.id)).toBe(true);
    });
  });

  describe('roles (Owner / Organizer / Moderator)', () => {
    it('lets the Owner grant Organizer, and the Organizer grant Moderator, but not vice versa', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);

      const organizerGrant = await bodyOf<EventRoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/roles`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(ORGANIZER_TOKEN),
            role: 'ORGANIZER',
          })
          .expect(201),
      );
      expect(organizerGrant.role).toBe('ORGANIZER');

      // The new Organizer may grant Moderator...
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/roles`)
        .set('Authorization', `Bearer ${ORGANIZER_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(MODERATOR_TOKEN),
          role: 'MODERATOR',
        })
        .expect(201);

      // ...but not grant a second Organizer - only the Owner may.
      const forbidden = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/roles`)
          .set('Authorization', `Bearer ${ORGANIZER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(MEMBER_TOKEN),
            role: 'ORGANIZER',
          })
          .expect(403),
      );
      expect(forbidden.code).toBe('INSUFFICIENT_EVENT_PERMISSIONS');

      const roles = await bodyOf<EventRoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/roles`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(roles.map((r) => r.role).sort()).toEqual([
        'MODERATOR',
        'ORGANIZER',
        'OWNER',
      ]);
    });

    it('never allows revoking OWNER directly, and transfers ownership atomically', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);
      const roles = await bodyOf<EventRoleAssignmentResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/roles`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const ownerRow = roles.find((r) => r.role === EventRole.OWNER);

      const removeOwnerResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/events/${event.id}/roles/${ownerRow?.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(removeOwnerResponse.code).toBe('CANNOT_REMOVE_EVENT_OWNER');

      const transfer = await bodyOf<EventRoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ toUserId: localUserIdByToken.get(ORGANIZER_TOKEN) })
          // No @HttpCode override - default POST status (201).
          .expect(201),
      );
      expect(transfer.role).toBe('OWNER');
      expect(transfer.userId).toBe(localUserIdByToken.get(ORGANIZER_TOKEN));

      // The former owner holds no Event role at all after transferring away
      // their only one, so the guard treats them like any other stranger -
      // 404, never a 403 that would confirm the Event's existence to them.
      const formerOwnerResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ toUserId: localUserIdByToken.get(MEMBER_TOKEN) })
          .expect(404),
      );
      expect(formerOwnerResponse.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('visibility, publish/draft and status history', () => {
    it('hides a DRAFT event from everyone except its Event role holders', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);

      const hidden = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(hidden.code).toBe('EVENT_NOT_FOUND');

      await request(app.getHttpServer())
        .get(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200);
    });

    it('makes a COMMUNITY_MEMBERS event visible to members only once published, and records status history', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        visibility: EventVisibility.COMMUNITY_MEMBERS,
      });

      await publishEvent(OWNER_TOKEN, event.id);

      await request(app.getHttpServer())
        .get(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);

      const history = await bodyOf<EventStatusHistoryResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/history`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(history.map((h) => h.toStatus)).toEqual(['DRAFT', 'PUBLISHED']);
      expect(history[0].fromStatus).toBeNull();
      expect(history[1].fromStatus).toBe('DRAFT');
    });

    it('makes a PUBLIC event visible even to non-members', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        visibility: EventVisibility.PUBLIC,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      await request(app.getHttpServer())
        .get(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(200);
    });

    it('cancels an Event and blocks further registration', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);
      await publishEvent(OWNER_TOKEN, event.id);

      const cancelled = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/cancel`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ reason: 'Venue unavailable' })
          // No @HttpCode override - default POST status (201).
          .expect(201),
      );
      expect(cancelled.status).toBe('CANCELLED');

      const registerAfterCancel = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(409),
      );
      expect(registerAfterCancel.code).toBe('EVENT_CANCELLED');
    });

    it('lets a Community Admin/Owner cancel via EVENT_MODERATE even without any Event role', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);
      await publishEvent(OWNER_TOKEN, event.id);
      // Transfer Event ownership away from the Community Owner so they hold
      // no Event role at all, then verify they can still cancel via the
      // Community-level GroupPermission.EVENT_MODERATE override.
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ toUserId: localUserIdByToken.get(ORGANIZER_TOKEN) })
        .expect(201);

      const cancelled = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/cancel`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({})
          // No @HttpCode override - default POST status (201).
          .expect(201),
      );
      expect(cancelled.status).toBe('CANCELLED');
    });
  });

  describe('registration, RSVP and waitlist', () => {
    it('registers a member, fills capacity, waitlists further registrations, and auto-promotes on a freed seat', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.AUTOMATIC,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const first = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(201),
      );
      expect(first[0].isWaitlisted).toBe(false);

      const second = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(201),
      );
      expect(second[0].isWaitlisted).toBe(true);

      // The first registrant withdraws - the waitlisted second registrant
      // should be promoted automatically.
      await request(app.getHttpServer())
        .patch(`/api/v1/events/${event.id}/rsvp/${first[0].id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ rsvpStatus: 'NOT_GOING' })
        .expect(200);

      const participants = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/participants`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const promoted = participants.find((p) => p.id === second[0].id);
      expect(promoted?.isWaitlisted).toBe(false);
      expect(promoted?.promotedAt).not.toBeNull();
    });

    it('rejects registration with no waitlist once capacity is full', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.NONE,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/register`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ attendSelf: true, children: [] })
        .expect(201);

      const full = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MODERATOR_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(409),
      );
      expect(full.code).toBe('EVENT_FULL');
    });

    it('rejects a non-member self-registering a COMMUNITY_MEMBERS event', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        visibility: EventVisibility.COMMUNITY_MEMBERS,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const notAllowed = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(403),
      );
      expect(notAllowed.code).toBe('EVENT_REGISTRATION_NOT_ALLOWED');
    });

    it('registers a CHILD_DEPENDENT and auto-assigns the registering parent as guardian', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);
      await publishEvent(OWNER_TOKEN, event.id);

      const results = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({
            attendSelf: false,
            children: [
              { subjectType: 'CHILD_DEPENDENT', displayName: 'Little One' },
            ],
          })
          .expect(201),
      );
      expect(results).toHaveLength(1);
      expect(results[0].displayName).toBe('Little One');
      expect(results[0].guardianUserId).toBe(
        localUserIdByToken.get(MEMBER_TOKEN),
      );
    });

    it('lets only the registering user change their own RSVP', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);
      await publishEvent(OWNER_TOKEN, event.id);

      const [attendee] = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(201),
      );

      const forbiddenRsvp = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/events/${event.id}/rsvp/${attendee.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ rsvpStatus: 'MAYBE' })
          .expect(403),
      );
      expect(forbiddenRsvp.code).toBe('NOT_YOUR_REGISTRATION');

      const updatedRsvp = await bodyOf<EventAttendeeResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/events/${event.id}/rsvp/${attendee.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ rsvpStatus: 'MAYBE' })
          .expect(200),
      );
      expect(updatedRsvp.rsvpStatus).toBe('MAYBE');
    });
  });

  describe('invitations (INVITE_ONLY)', () => {
    it('only allows a registered invitee to self-register, and the invitation becomes ACCEPTED implicitly', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        visibility: EventVisibility.INVITE_ONLY,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      // Not invited: cannot see or register, even though they're a Community member.
      await request(app.getHttpServer())
        .get(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/invitations`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ userId: localUserIdByToken.get(MEMBER_TOKEN) })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/register`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ attendSelf: true, children: [] })
        .expect(201);

      const invitations = await bodyOf<
        { status: string; invitedUserId: string }[]
      >(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/invitations`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(invitations[0].status).toBe('ACCEPTED');
    });

    it('lets an invitee decline without registering', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        visibility: EventVisibility.INVITE_ONLY,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const invitation = await bodyOf<{ id: string }>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/invitations`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ userId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(201),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/invitations/${invitation.id}/decline`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/register`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ attendSelf: true, children: [] })
        .expect(403);
    });
  });

  describe('check-in', () => {
    it('identifies a scanned user by their personal code and marks them present', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);
      await publishEvent(OWNER_TOKEN, event.id);
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/roles`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(ORGANIZER_TOKEN),
          role: 'ORGANIZER',
        })
        .expect(201);

      const memberAttendee = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(201),
      );

      const memberProfile = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(memberProfile.publicCode).toEqual(expect.any(String));

      const identified = await bodyOf<{
        user: { id: string };
        selfAttendee: EventAttendeeResponseDto | null;
      }>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/checkin/identify`)
          .set('Authorization', `Bearer ${ORGANIZER_TOKEN}`)
          .send({ code: memberProfile.publicCode })
          .expect(201),
      );
      expect(identified.user.id).toBe(localUserIdByToken.get(MEMBER_TOKEN));
      expect(identified.selfAttendee?.id).toBe(memberAttendee[0].id);

      const checkedIn = await bodyOf<EventAttendeeResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/checkin/${memberAttendee[0].id}`)
          .set('Authorization', `Bearer ${ORGANIZER_TOKEN}`)
          .send({ method: 'QR' })
          .expect(201),
      );
      expect(checkedIn.checkedIn).toBe(true);
      expect(checkedIn.checkInMethod).toBe('QR');

      const alreadyCheckedIn = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/checkin/${memberAttendee[0].id}`)
          .set('Authorization', `Bearer ${ORGANIZER_TOKEN}`)
          .send({ method: 'MANUAL' })
          .expect(409),
      );
      expect(alreadyCheckedIn.code).toBe('ATTENDEE_ALREADY_CHECKED_IN');

      const undone = await bodyOf<EventAttendeeResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/events/${event.id}/checkin/${memberAttendee[0].id}/undo`,
          )
          .set('Authorization', `Bearer ${ORGANIZER_TOKEN}`)
          .expect(201),
      );
      expect(undone.checkedIn).toBe(false);
    });

    it('rejects check-in attempts by someone without EVENT_CHECKIN', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id);
      await publishEvent(OWNER_TOKEN, event.id);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/checkin/identify`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ code: 'ABCD-1234' })
          .expect(404),
      );
      expect(response.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('status lifecycle guards', () => {
    it('blocks transfer-ownership, role grants, invitations, and manual promotion once CANCELLED', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        capacity: 5,
        waitlistPolicy: EventWaitlistPolicy.MANUAL,
      });
      await publishEvent(OWNER_TOKEN, event.id);
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({})
        .expect(201);

      const transferResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ toUserId: localUserIdByToken.get(ORGANIZER_TOKEN) })
          .expect(409),
      );
      expect(transferResponse.code).toBe('EVENT_CANCELLED');

      const grantRoleResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/roles`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(ORGANIZER_TOKEN),
            role: 'ORGANIZER',
          })
          .expect(409),
      );
      expect(grantRoleResponse.code).toBe('EVENT_CANCELLED');

      const invitationResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/invitations`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ userId: localUserIdByToken.get(MEMBER_TOKEN) })
          .expect(409),
      );
      expect(invitationResponse.code).toBe('EVENT_CANCELLED');

      // A well-formed but non-existent attendee id is enough - the status
      // check runs before the attendee is looked up.
      const promoteResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/events/${event.id}/participants/00000000-0000-0000-0000-000000000000/promote`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(promoteResponse.code).toBe('EVENT_CANCELLED');

      const rsvpResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(409),
      );
      expect(rsvpResponse.code).toBe('EVENT_CANCELLED');

      const checkInResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/checkin/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ code: 'ABCD-1234' })
          .expect(409),
      );
      expect(checkInResponse.code).toBe('EVENT_CANCELLED');
    });

    it('blocks transfer-ownership, role grants, invitations, guardians, and manual promotion once FINISHED, but still allows check-in', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        capacity: 5,
        waitlistPolicy: EventWaitlistPolicy.MANUAL,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      // Register while still PUBLISHED (endsAt is still in the future at
      // this point), then push endsAt into the past directly in the
      // database - registering against an already-past endsAt would itself
      // be rejected, since the very next load lazily reconciles PUBLISHED
      // -> FINISHED (see reconcileEventFinished) before the register
      // endpoint's own status check runs.
      const memberAttendee = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/register`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ attendSelf: true, children: [] })
          .expect(201),
      );

      const em = app.get(EntityManager).fork();
      await em.nativeUpdate(
        Event,
        { id: event.id },
        { endsAt: new Date('2020-01-10T18:00:00.000Z') },
      );

      // Reading the Event now triggers the lazy FINISHED reconciliation.
      const afterFinish = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(afterFinish.status).toBe('FINISHED');

      const transferResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ toUserId: localUserIdByToken.get(ORGANIZER_TOKEN) })
          .expect(409),
      );
      expect(transferResponse.code).toBe('EVENT_FINISHED');

      const grantRoleResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/roles`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(ORGANIZER_TOKEN),
            role: 'ORGANIZER',
          })
          .expect(409),
      );
      expect(grantRoleResponse.code).toBe('EVENT_FINISHED');

      const invitationResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/invitations`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ userId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(409),
      );
      expect(invitationResponse.code).toBe('EVENT_FINISHED');

      const guardianResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/events/${event.id}/attendees/${memberAttendee[0].id}/guardian`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ guardianUserId: localUserIdByToken.get(MEMBER_TOKEN) })
          .expect(409),
      );
      expect(guardianResponse.code).toBe('EVENT_FINISHED');

      const promoteResponse = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(
            `/api/v1/events/${event.id}/participants/${memberAttendee[0].id}/promote`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(409),
      );
      expect(promoteResponse.code).toBe('EVENT_FINISHED');

      // Check-in and undo remain available once FINISHED.
      const memberProfile = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/checkin/${memberAttendee[0].id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ method: 'MANUAL' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/checkin/${memberAttendee[0].id}/undo`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      expect(memberProfile.publicCode).toEqual(expect.any(String));
    });
  });

  describe('concurrent registrations under a capacity limit', () => {
    it('never seats more attendees than capacity when many registrations race', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        visibility: EventVisibility.PUBLIC,
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.NONE,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const contenders = [
        OWNER_TOKEN,
        ORGANIZER_TOKEN,
        MODERATOR_TOKEN,
        MEMBER_TOKEN,
        OUTSIDER_TOKEN,
      ];

      const results = await Promise.all(
        contenders.map((token) =>
          request(app.getHttpServer())
            .post(`/api/v1/events/${event.id}/register`)
            .set('Authorization', `Bearer ${token}`)
            .send({ attendSelf: true, children: [] }),
        ),
      );

      const succeeded = results.filter((res) => res.status === 201);
      const rejected = results.filter((res) => res.status === 409);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(contenders.length - 1);
      for (const response of rejected) {
        expect((response.body as HttpErrorResponse).code).toBe('EVENT_FULL');
      }

      const participants = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/participants`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const seated = participants.filter((p) => !p.isWaitlisted);
      expect(seated).toHaveLength(1);
    });

    it('waitlists every registration beyond capacity under an AUTOMATIC policy, never seating more than capacity', async () => {
      const community = await createCommunityWithMembers();
      const event = await createEvent(OWNER_TOKEN, community.id, {
        visibility: EventVisibility.PUBLIC,
        capacity: 2,
        waitlistPolicy: EventWaitlistPolicy.AUTOMATIC,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const contenders = [
        OWNER_TOKEN,
        ORGANIZER_TOKEN,
        MODERATOR_TOKEN,
        MEMBER_TOKEN,
        OUTSIDER_TOKEN,
      ];

      await Promise.all(
        contenders.map((token) =>
          request(app.getHttpServer())
            .post(`/api/v1/events/${event.id}/register`)
            .set('Authorization', `Bearer ${token}`)
            .send({ attendSelf: true, children: [] }),
        ),
      );

      const participants = await bodyOf<EventAttendeeResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${event.id}/participants`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(participants).toHaveLength(contenders.length);
      const seated = participants.filter((p) => !p.isWaitlisted);
      const waitlisted = participants.filter((p) => p.isWaitlisted);
      expect(seated).toHaveLength(2);
      expect(waitlisted).toHaveLength(contenders.length - 2);
    });
  });

  describe('global events feed (GET /events)', () => {
    // A distinct, otherwise-unused date window per test, and a matching
    // from/to filter on every request - the shared test database
    // accumulates events across every other test in this file (`startsAt`
    // defaults to the same instant in eventPayload()), so an unscoped
    // request could easily miss a just-created event past the default
    // limit of 20. Scoping by date keeps every assertion exact rather than
    // a defensive `.some(...)`.
    function globalFeedEvent(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return eventPayload({
        startsAt: '2031-03-01T10:00:00.000Z',
        endsAt: '2031-03-01T18:00:00.000Z',
        ...overrides,
      });
    }

    async function fetchGlobalFeed(token: string): Promise<EventResponseDto[]> {
      const result = await bodyOf<{ items: EventResponseDto[] }>(
        request(app.getHttpServer())
          .get('/api/v1/events')
          .query({
            from: '2031-02-28T00:00:00.000Z',
            to: '2031-03-02T00:00:00.000Z',
            limit: 100,
          })
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      );
      return result.items;
    }

    it('includes a PUBLIC event for a non-member, but excludes a COMMUNITY_MEMBERS event under a community they do not belong to', async () => {
      const community = await createCommunityWithMembers();
      const publicEvent = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(
            globalFeedEvent({
              name: 'Global Feed Public Event',
              visibility: EventVisibility.PUBLIC,
            }),
          )
          .expect(201),
      );
      await publishEvent(OWNER_TOKEN, publicEvent.id);

      const membersOnlyEvent = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(
            globalFeedEvent({
              name: 'Global Feed Members-Only Event',
              visibility: EventVisibility.COMMUNITY_MEMBERS,
            }),
          )
          .expect(201),
      );
      await publishEvent(OWNER_TOKEN, membersOnlyEvent.id);

      const feed = await fetchGlobalFeed(OUTSIDER_TOKEN);

      expect(feed.some((e) => e.id === publicEvent.id)).toBe(true);
      expect(feed.some((e) => e.id === membersOnlyEvent.id)).toBe(false);
    });

    it('includes a COMMUNITY_MEMBERS event for an active member of its Group, with no per-community request', async () => {
      const community = await createCommunityWithMembers();
      const event = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(
            globalFeedEvent({
              name: 'Global Feed Member-Visible Event',
              visibility: EventVisibility.COMMUNITY_MEMBERS,
            }),
          )
          .expect(201),
      );
      await publishEvent(OWNER_TOKEN, event.id);

      const feed = await fetchGlobalFeed(MEMBER_TOKEN);

      expect(feed.some((e) => e.id === event.id)).toBe(true);
    });

    it('includes a Section-scoped event for an active member of the parent Group, with no per-Section request', async () => {
      const community = await createCommunityWithMembers();
      const section = await bodyOf<{ id: string }>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            name: 'Global Feed Section',
            timezone: 'Europe/Warsaw',
            currencyCode: 'PLN',
            country: 'PL',
          })
          .expect(201),
      );
      createdGroupIds.push(section.id);

      const event = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(
            globalFeedEvent({
              name: 'Global Feed Section Event',
              visibility: EventVisibility.COMMUNITY_MEMBERS,
            }),
          )
          .expect(201),
      );
      await publishEvent(OWNER_TOKEN, event.id);

      const feed = await fetchGlobalFeed(MEMBER_TOKEN);

      expect(feed.some((e) => e.id === event.id)).toBe(true);
    });

    it('excludes a DRAFT event for someone with no Event role, but includes it for its own Owner via their Event role', async () => {
      const community = await createCommunityWithMembers();
      const draft = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(globalFeedEvent({ name: 'Global Feed Draft Event' }))
          .expect(201),
      );

      const outsiderFeed = await fetchGlobalFeed(OUTSIDER_TOKEN);
      expect(outsiderFeed.some((e) => e.id === draft.id)).toBe(false);

      const ownerFeed = await fetchGlobalFeed(OWNER_TOKEN);
      expect(ownerFeed.some((e) => e.id === draft.id)).toBe(true);
    });
  });
});
