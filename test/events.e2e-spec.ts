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
import { User } from '../src/users/entities/user.entity';
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { Section } from '../src/groups/entities/section.entity';
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
import { EventStatus } from '../src/events/enums/event-status.enum';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';

const OWNER_TOKEN = 'valid-events-owner-token';
const ORGANIZER_TOKEN = 'valid-events-organizer-token';
const MODERATOR_TOKEN = 'valid-events-moderator-token';
const MEMBER_TOKEN = 'valid-events-member-token';
const OUTSIDER_TOKEN = 'valid-events-outsider-token';
// Dedicated, single-use identities for DELETE /users/me tests below - never
// reused for anything else in this file, since deleting the account behind
// a token would otherwise silently recreate a *new* User row (a different
// id) for every later request that authenticates with it (see
// UserService.findOrCreateFromClerk), invalidating any earlier
// localUserIdByToken lookup for the shared OWNER/ORGANIZER/MODERATOR/
// MEMBER/OUTSIDER identities every other describe block in this file
// depends on.
const DELETABLE_HISTORICAL_TOKEN = 'valid-events-deletable-historical-token';
const DELETABLE_PUBLISHED_TOKEN = 'valid-events-deletable-published-token';
const DELETABLE_STILL_OWNER_TOKEN = 'valid-events-deletable-still-owner-token';

const OWNER_CLERK_ID = 'user_test_events_owner';
const ORGANIZER_CLERK_ID = 'user_test_events_organizer';
const MODERATOR_CLERK_ID = 'user_test_events_moderator';
const MEMBER_CLERK_ID = 'user_test_events_member';
const OUTSIDER_CLERK_ID = 'user_test_events_outsider';
const DELETABLE_HISTORICAL_CLERK_ID = 'user_test_events_deletable_historical';
const DELETABLE_PUBLISHED_CLERK_ID = 'user_test_events_deletable_published';
const DELETABLE_STILL_OWNER_CLERK_ID = 'user_test_events_deletable_still_owner';

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
  [DELETABLE_HISTORICAL_TOKEN]: {
    userId: DELETABLE_HISTORICAL_CLERK_ID,
    sessionId: 'sess_events_deletable_historical',
    tokenType: 'session_token',
    claims: {
      sub: DELETABLE_HISTORICAL_CLERK_ID,
      sid: 'sess_events_deletable_historical',
    },
  },
  [DELETABLE_PUBLISHED_TOKEN]: {
    userId: DELETABLE_PUBLISHED_CLERK_ID,
    sessionId: 'sess_events_deletable_published',
    tokenType: 'session_token',
    claims: {
      sub: DELETABLE_PUBLISHED_CLERK_ID,
      sid: 'sess_events_deletable_published',
    },
  },
  [DELETABLE_STILL_OWNER_TOKEN]: {
    userId: DELETABLE_STILL_OWNER_CLERK_ID,
    sessionId: 'sess_events_deletable_still_owner',
    tokenType: 'session_token',
    claims: {
      sub: DELETABLE_STILL_OWNER_CLERK_ID,
      sid: 'sess_events_deletable_still_owner',
    },
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
  [DELETABLE_HISTORICAL_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-deletable-historical.png',
    primaryEmailAddress: {
      emailAddress: 'events.deletable.historical@example.com',
    },
  },
  [DELETABLE_PUBLISHED_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-deletable-published.png',
    primaryEmailAddress: {
      emailAddress: 'events.deletable.published@example.com',
    },
  },
  [DELETABLE_STILL_OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/events-deletable-still-owner.png',
    primaryEmailAddress: {
      emailAddress: 'events.deletable.still.owner@example.com',
    },
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
  // Separate from createdGroupIds - a User-organized Event has no
  // Group/Section at all (see event-community.util.ts), so it is never
  // reachable through the community-scoped cleanup filters below.
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

      // User-organized Events - cleaned up by their own ids, not by
      // community (they have none). Must run before the User rows below
      // are deleted: Event.organizerUser is `deleteRule: 'no action'` (see
      // event.entity.ts), so a User row still referenced as organizerUser
      // cannot be deleted first.
      if (createdPersonalEventIds.length > 0) {
        const eventIsPersonal = { event: { $in: createdPersonalEventIds } };
        await cleanup.nativeDelete(EventGuardianAssignment, eventIsPersonal);
        await cleanup.nativeDelete(EventAttendee, eventIsPersonal);
        await cleanup.nativeDelete(EventInvitation, eventIsPersonal);
        await cleanup.nativeDelete(EventRoleAssignment, eventIsPersonal);
        await cleanup.nativeDelete(EventStatusHistory, eventIsPersonal);
        await cleanup.nativeDelete(Event, {
          id: { $in: createdPersonalEventIds },
        });
      }

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

  // Group has no membership/MEMBER role at all (see the Membership/
  // RoleAssignments rebuild) - the only Roles it ever grants are
  // OWNER/ADMIN, via a direct RoleAssignment. Every "is this user a
  // community member" fixture below uses ADMIN - sufficient for
  // isCommunityMember()/COMMUNITY_MEMBERS visibility, which is all these
  // three tokens need at the Group level (their actual Event-level
  // standing is granted separately, per-Event, via /events/:id/roles).
  async function grantGroupRole(
    ownerToken: string,
    groupId: string,
    memberToken: string,
    role: GroupRole = GroupRole.ADMIN,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  // Section has real membership - joining always grants MEMBER atomically.
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

  async function createCommunityWithMembers(): Promise<GroupResponseDto> {
    const community = await createGroup(OWNER_TOKEN);
    await grantGroupRole(OWNER_TOKEN, community.id, ORGANIZER_TOKEN);
    await grantGroupRole(OWNER_TOKEN, community.id, MODERATOR_TOKEN);
    await grantGroupRole(OWNER_TOKEN, community.id, MEMBER_TOKEN);
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

  // POST /events - creates an Event organized by `token`'s own User,
  // never a Group/Section (see EventsService.createPersonal). Tracks the
  // created id separately from createdGroupIds so afterAll can clean it up
  // by its own id (see createdPersonalEventIds above).
  async function createPersonalEvent(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    const created = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${token}`)
        .send(
          eventPayload({ visibility: EventVisibility.PUBLIC, ...overrides }),
        )
        .expect(201),
    );
    createdPersonalEventIds.push(created.id);
    return created;
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
      // Organizer identity resolves to the Group, with its logo passed
      // through as the organizer's image - `community` stays populated too
      // for backward compatibility (see event-response.dto.ts).
      expect(created.organizer).toMatchObject({
        type: 'GROUP',
        id: community.id,
        name: community.name,
      });
      expect(created.community).not.toBeNull();
    });

    it('rejects creation by a plain MEMBER - 403 INSUFFICIENT_GROUP_PERMISSIONS (a Group has no MEMBER tier at all, so this is exercised on a Section)', async () => {
      const community = await createGroup(OWNER_TOKEN);
      const section = await bodyOf<{ id: string }>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/sections`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            name: 'Plain Member Cannot Create Events Section',
            timezone: 'Europe/Warsaw',
            currencyCode: 'PLN',
            country: 'PL',
            city: 'Poznań',
            region: 'Greater Poland',
            geonameId: 3088171,
          })
          .expect(201),
      );
      createdGroupIds.push(section.id);
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/events`)
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
            city: 'Poznań',
            region: 'Greater Poland',
            geonameId: 3088171,
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
      expect(created.organizer).toMatchObject({
        type: 'SECTION',
        id: section.id,
      });

      const list = await bodyOf<{ items: EventResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(list.items.some((event) => event.id === created.id)).toBe(true);
    });
  });

  describe('EventType', () => {
    it.each(['FESTIVAL', 'WORKSHOP', 'OPEN_RODA'] as const)(
      'creates an Event of type %s',
      async (type) => {
        const community = await createCommunityWithMembers();

        const created = await createEvent(OWNER_TOKEN, community.id, {
          type,
          customTypeLabel: null,
        });

        expect(created.type).toBe(type);
        expect(created.customTypeLabel).toBeNull();
      },
    );

    it('creates an Event of type OTHER with a customTypeLabel', async () => {
      const community = await createCommunityWithMembers();

      const created = await createEvent(OWNER_TOKEN, community.id, {
        type: 'OTHER',
        customTypeLabel: 'Community Cookout',
      });

      expect(created.type).toBe('OTHER');
      expect(created.customTypeLabel).toBe('Community Cookout');
    });

    it('rejects an unknown/legacy type (e.g. a pre-cleanup BATIZADO) with 400 VALIDATION_ERROR', async () => {
      const community = await createCommunityWithMembers();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(eventPayload({ type: 'BATIZADO' }))
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('rejects OTHER without a customTypeLabel, and rejects a customTypeLabel on a non-OTHER type', async () => {
      const community = await createCommunityWithMembers();

      const missingLabel = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(eventPayload({ type: 'OTHER', customTypeLabel: null }))
          .expect(400),
      );
      expect(missingLabel.code).toBe('VALIDATION_ERROR');

      const unexpectedLabel = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${community.id}/events`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(
            eventPayload({ type: 'WORKSHOP', customTypeLabel: 'Not allowed' }),
          )
          .expect(400),
      );
      expect(unexpectedLabel.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('update - type is immutable', () => {
    function updatePayload(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      // Deliberately no `type`/`customTypeLabel` key - update-event.schema.ts
      // excludes both entirely (see EventType cleanup report).
      return {
        name: 'Updated Name',
        description: 'Updated description',
        coverImageUrl: null,
        startsAt: '2027-02-10T10:00:00.000Z',
        endsAt: '2027-02-10T18:00:00.000Z',
        locationName: 'Updated hall',
        locationAddress: null,
        latitude: null,
        longitude: null,
        visibility: EventVisibility.COMMUNITY_MEMBERS,
        capacity: null,
        waitlistPolicy: EventWaitlistPolicy.NONE,
        ...overrides,
      };
    }

    it('updates an Event without eventType/type in the body - other fields change, type is untouched', async () => {
      const community = await createCommunityWithMembers();
      const created = await createEvent(OWNER_TOKEN, community.id, {
        type: 'WORKSHOP',
      });

      const updated = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(updatePayload({ name: 'Renamed Workshop' }))
          .expect(200),
      );

      expect(updated.name).toBe('Renamed Workshop');
      expect(updated.type).toBe('WORKSHOP');
    });

    it('ignores a `type` smuggled into the update body - the Event keeps its original type', async () => {
      const community = await createCommunityWithMembers();
      const created = await createEvent(OWNER_TOKEN, community.id, {
        type: 'FESTIVAL',
      });

      const updated = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ ...updatePayload(), type: 'WORKSHOP' })
          .expect(200),
      );

      expect(updated.type).toBe('FESTIVAL');
    });

    it('keeps type unchanged across multiple successive updates', async () => {
      const community = await createCommunityWithMembers();
      const created = await createEvent(OWNER_TOKEN, community.id, {
        type: 'OPEN_RODA',
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/events/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(updatePayload({ name: 'First rename' }))
        .expect(200);

      const secondUpdate = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(updatePayload({ name: 'Second rename' }))
          .expect(200),
      );

      expect(secondUpdate.name).toBe('Second rename');
      expect(secondUpdate.type).toBe('OPEN_RODA');

      const fetched = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.type).toBe('OPEN_RODA');
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
          .post(`/api/v1/events/${event.id}/attendance/identify`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ identity: '123456' })
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
        {
          // startsAt is pushed into the past too, not just endsAt - the
          // numericCode/QR check-in flow (see event-attendance.service.ts)
          // additionally requires the Event to have already started, a
          // rule the removed legacy check-in never enforced.
          startsAt: new Date('2020-01-10T10:00:00.000Z'),
          endsAt: new Date('2020-01-10T18:00:00.000Z'),
        },
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

      // Check-in and marking absent again both remain available once
      // FINISHED (numericCode/QR check-in - see event-attendance.service.ts;
      // the legacy publicCode-based check-in this test used to exercise
      // here has been removed entirely).
      const memberProfile = await bodyOf<UserProfileResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/profile')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/check-in`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ identity: memberProfile.numericCode })
        .expect(201);
      await request(app.getHttpServer())
        .put(
          `/api/v1/events/${event.id}/attendance/${localUserIdByToken.get(MEMBER_TOKEN)}`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ attended: false })
        .expect(200);
      expect(memberProfile.numericCode).toEqual(expect.any(String));
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

    it('includes a Section-scoped event for an active member of that exact Section, but not for a Group-level participant who never joined it (no inheritance)', async () => {
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
            city: 'Poznań',
            region: 'Greater Poland',
            geonameId: 3088171,
          })
          .expect(201),
      );
      createdGroupIds.push(section.id);
      await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);

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

      // MEMBER_TOKEN actually joined the Section - sees it.
      const feed = await fetchGlobalFeed(MEMBER_TOKEN);
      expect(feed.some((e) => e.id === event.id)).toBe(true);

      // ORGANIZER_TOKEN only holds Group-level ADMIN (from
      // createCommunityWithMembers) and never joined this Section - a
      // Group Role grants nothing on a Section (no inheritance).
      const organizerFeed = await fetchGlobalFeed(ORGANIZER_TOKEN);
      expect(organizerFeed.some((e) => e.id === event.id)).toBe(false);
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

  describe('User-organized Events (POST /events)', () => {
    it('creates an Event organized by the caller themselves, with no community', async () => {
      const created = await createPersonalEvent(OWNER_TOKEN, {
        name: 'Workshop Mestre Acordeon',
      });

      expect(created.status).toBe('DRAFT');
      expect(created.createdByUserId).toBe(localUserIdByToken.get(OWNER_TOKEN));
      expect(created.community).toBeNull();
      expect(created.organizer).toEqual({
        type: 'USER',
        id: localUserIdByToken.get(OWNER_TOKEN),
        // Seeded from the Clerk fixture profile at first login (see
        // FIXTURE_CLERK_PROFILES/generateDisplayNameFromEmail).
        name: 'Events Owner',
        image: {
          type: 'CLERK',
          url: 'https://img.clerk.com/events-owner.png',
          presetAvatarId: null,
        },
      });
    });

    it('grants the creator EventRole.OWNER, with matching capabilities', async () => {
      const created = await createPersonalEvent(OWNER_TOKEN);

      expect(created.viewerRoles).toEqual(['OWNER']);
      expect(created.capabilities).toMatchObject({
        canEdit: true,
        canPublish: true,
        canManageOrganizers: true,
        canTransferOwnership: true,
      });
    });

    it('rejects COMMUNITY_MEMBERS visibility with a 400 EVENT_VISIBILITY_REQUIRES_COMMUNITY', async () => {
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/events')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(eventPayload({ visibility: EventVisibility.COMMUNITY_MEMBERS }))
          .expect(400),
      );

      expect(response.code).toBe('EVENT_VISIBILITY_REQUIRES_COMMUNITY');
    });

    it('is reachable via direct GET /events/:eventId', async () => {
      const created = await createPersonalEvent(OWNER_TOKEN);

      const fetched = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(fetched.id).toBe(created.id);
      expect(fetched.organizer.type).toBe('USER');
    });

    it('cannot change organizer identity via PATCH, and rejects switching to COMMUNITY_MEMBERS visibility', async () => {
      const created = await createPersonalEvent(OWNER_TOKEN, {
        name: 'Immutable Organizer Event',
      });

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(
            eventPayload({
              name: 'Immutable Organizer Event',
              visibility: EventVisibility.COMMUNITY_MEMBERS,
            }),
          )
          .expect(400),
      );
      expect(response.code).toBe('EVENT_VISIBILITY_REQUIRES_COMMUNITY');

      // A normal PUBLIC update still works, and the organizer never moves -
      // UpdateEventRequest has no organizer-identity field at all (see
      // update-event.schema.ts).
      const updated = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send(
            eventPayload({
              name: 'Renamed, Still Mine',
              visibility: EventVisibility.PUBLIC,
            }),
          )
          .expect(200),
      );
      expect(updated.name).toBe('Renamed, Still Mine');
      expect(updated.organizer).toEqual(created.organizer);
    });

    it('transferring EventRole.OWNER moves administrative control but never the public organizer identity', async () => {
      const created = await createPersonalEvent(OWNER_TOKEN, {
        name: 'Ownership Transfer Personal Event',
      });
      const originalOrganizer = created.organizer;

      // No Community membership exists to check here at all - transferring
      // to a User with no relationship whatsoever to the creator still
      // succeeds (see EventRolesService.transferOwnership).
      const transfer = await bodyOf<EventRoleAssignmentResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/events/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ toUserId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(201),
      );
      expect(transfer.userId).toBe(localUserIdByToken.get(OUTSIDER_TOKEN));

      const afterTransfer = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(200),
      );
      // The new Owner now has full management capabilities...
      expect(afterTransfer.viewerRoles).toEqual(['OWNER']);
      expect(afterTransfer.capabilities.canEdit).toBe(true);
      // ...but the public organizer identity is unchanged - it is still the
      // original creator, not the new Owner (see event.entity.ts's class
      // comment: organizerUser has no transfer mechanism).
      expect(afterTransfer.organizer).toEqual(originalOrganizer);
    });

    describe('listing', () => {
      function personalFeedEvent(
        overrides: Record<string, unknown> = {},
      ): Record<string, unknown> {
        return eventPayload({
          startsAt: '2032-04-01T10:00:00.000Z',
          endsAt: '2032-04-01T18:00:00.000Z',
          visibility: EventVisibility.PUBLIC,
          ...overrides,
        });
      }

      async function fetchGlobalFeed(
        token: string,
      ): Promise<EventResponseDto[]> {
        const result = await bodyOf<{ items: EventResponseDto[] }>(
          request(app.getHttpServer())
            .get('/api/v1/events')
            .query({
              from: '2032-03-30T00:00:00.000Z',
              to: '2032-04-02T00:00:00.000Z',
              limit: 100,
            })
            .set('Authorization', `Bearer ${token}`)
            .expect(200),
        );
        return result.items;
      }

      it('does not appear under GET /groups/:id/events or GET /sections/:id/events - it belongs to no community', async () => {
        const community = await createCommunityWithMembers();
        const personal = await createPersonalEvent(
          OWNER_TOKEN,
          personalFeedEvent({ name: 'Personal Event Not In Group List' }),
        );

        const groupList = await bodyOf<{ items: EventResponseDto[] }>(
          request(app.getHttpServer())
            .get(`/api/v1/groups/${community.id}/events`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(200),
        );
        expect(groupList.items.some((e) => e.id === personal.id)).toBe(false);
      });

      it('is visible to any signed-in user via the global feed once PUBLISHED', async () => {
        const personal = await createPersonalEvent(
          OWNER_TOKEN,
          personalFeedEvent({ name: 'Personal Event In Global Feed' }),
        );
        await publishEvent(OWNER_TOKEN, personal.id);

        const feed = await fetchGlobalFeed(OUTSIDER_TOKEN);
        expect(feed.some((e) => e.id === personal.id)).toBe(true);
      });

      it("is included in the creator's own feed via My Events, even as a DRAFT", async () => {
        const personal = await createPersonalEvent(
          OWNER_TOKEN,
          personalFeedEvent({ name: 'Personal Draft Event For Owner' }),
        );

        const ownFeed = await fetchGlobalFeed(OWNER_TOKEN);
        expect(ownFeed.some((e) => e.id === personal.id)).toBe(true);

        const strangerFeed = await fetchGlobalFeed(OUTSIDER_TOKEN);
        expect(strangerFeed.some((e) => e.id === personal.id)).toBe(false);
      });
    });

    describe('archive lifecycle', () => {
      // Fast-forwards a PUBLISHED Event into the past and reads it once,
      // triggering the same lazy PUBLISHED -> FINISHED reconciliation used
      // throughout "status lifecycle guards" above.
      async function forceFinish(
        eventId: string,
        token: string,
      ): Promise<EventResponseDto> {
        const em = app.get(EntityManager).fork();
        await em.nativeUpdate(
          Event,
          { id: eventId },
          {
            startsAt: new Date('2020-01-10T10:00:00.000Z'),
            endsAt: new Date('2020-01-10T18:00:00.000Z'),
          },
        );
        return bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .get(`/api/v1/events/${eventId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200),
        );
      }

      it('archives a FINISHED Event: it stays readable with history, but every operational capability is false and management/register are blocked', async () => {
        const created = await createPersonalEvent(OWNER_TOKEN, {
          name: 'Archive Lifecycle Event',
        });
        await publishEvent(OWNER_TOKEN, created.id);
        const finished = await forceFinish(created.id, OWNER_TOKEN);
        expect(finished.status).toBe('FINISHED');

        const archived = await bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .post(`/api/v1/events/${created.id}/archive`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(201),
        );
        expect(archived.status).toBe('ARCHIVED');

        // Details and history both still resolve for a historical Event.
        const details = await bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .get(`/api/v1/events/${created.id}`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(200),
        );
        expect(details.status).toBe('ARCHIVED');
        expect(details.organizer.type).toBe('USER');

        const history = await bodyOf<EventStatusHistoryResponseDto[]>(
          request(app.getHttpServer())
            .get(`/api/v1/events/${created.id}/history`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(200),
        );
        expect(history.some((h) => h.toStatus === EventStatus.ARCHIVED)).toBe(
          true,
        );

        // Every operational capability is false - read access
        // (canViewManagement) is the only one still true for a role holder.
        expect(details.capabilities).toEqual({
          canViewManagement: true,
          canEdit: false,
          canPublish: false,
          canCancel: false,
          canFinish: false,
          canManageOrganizers: false,
          canManageModerators: false,
          canTransferOwnership: false,
          canManageInvitations: false,
          canManageParticipants: false,
          canCheckIn: false,
          canRegister: false,
        });

        const patchResponse = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .patch(`/api/v1/events/${created.id}`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .send(
              eventPayload({
                name: 'Should never apply',
                visibility: EventVisibility.PUBLIC,
              }),
            )
            .expect(409),
        );
        expect(patchResponse.code).toBe('EVENT_ARCHIVED');

        const registerResponse = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/events/${created.id}/register`)
            .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
            .send({ attendSelf: true, children: [] })
            .expect(409),
        );
        expect(registerResponse.code).toBe('EVENT_ARCHIVED');
      });

      it('rejects archiving a DRAFT or PUBLISHED Event - only FINISHED/CANCELLED qualify', async () => {
        const draft = await createPersonalEvent(OWNER_TOKEN, {
          name: 'Draft Cannot Archive',
        });
        const draftResponse = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/events/${draft.id}/archive`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(409),
        );
        expect(draftResponse.code).toBe('EVENT_DRAFT');

        const published = await createPersonalEvent(OWNER_TOKEN, {
          name: 'Published Cannot Archive Directly',
        });
        await publishEvent(OWNER_TOKEN, published.id);
        const publishedResponse = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/events/${published.id}/archive`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(409),
        );
        expect(publishedResponse.code).toBe('EVENT_PUBLISHED');
      });

      it('rejects re-archiving an already-ARCHIVED Event', async () => {
        const created = await createPersonalEvent(OWNER_TOKEN, {
          name: 'Re-archive Rejected',
        });
        await publishEvent(OWNER_TOKEN, created.id);
        await forceFinish(created.id, OWNER_TOKEN);
        await request(app.getHttpServer())
          .post(`/api/v1/events/${created.id}/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(201);

        const reArchiveResponse = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .post(`/api/v1/events/${created.id}/archive`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(409),
        );
        expect(reArchiveResponse.code).toBe('EVENT_ARCHIVED');
      });

      it('also archives a Group-organized Event - no regression from the USER-organized case', async () => {
        const community = await createCommunityWithMembers();
        const event = await createEvent(OWNER_TOKEN, community.id);
        await publishEvent(OWNER_TOKEN, event.id);
        await request(app.getHttpServer())
          .post(`/api/v1/events/${event.id}/cancel`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({})
          .expect(201);

        const archived = await bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .post(`/api/v1/events/${event.id}/archive`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(201),
        );
        expect(archived.status).toBe('ARCHIVED');
        expect(archived.organizer.type).toBe('GROUP');
      });
    });

    describe('account deletion of the organizer', () => {
      it("a FINISHED Event's organizer can delete their account - the Event survives, auto-archives, and keeps the organizer's historical name with no live profile", async () => {
        const created = await createPersonalEvent(DELETABLE_HISTORICAL_TOKEN, {
          name: 'Historical Organizer Deletion Event',
        });
        await publishEvent(DELETABLE_HISTORICAL_TOKEN, created.id);

        const em = app.get(EntityManager).fork();
        await em.nativeUpdate(
          Event,
          { id: created.id },
          {
            startsAt: new Date('2020-01-10T10:00:00.000Z'),
            endsAt: new Date('2020-01-10T18:00:00.000Z'),
          },
        );
        // Trigger the lazy FINISHED reconciliation before deleting the
        // account - same technique as the archive lifecycle tests above.
        await request(app.getHttpServer())
          .get(`/api/v1/events/${created.id}`)
          .set('Authorization', `Bearer ${DELETABLE_HISTORICAL_TOKEN}`)
          .expect(200);

        await request(app.getHttpServer())
          .delete('/api/v1/users/me')
          .set('Authorization', `Bearer ${DELETABLE_HISTORICAL_TOKEN}`)
          .expect(204);

        // The local User row is really gone.
        const deletedUser = await em.findOne(User, {
          clerkUserId: DELETABLE_HISTORICAL_CLERK_ID,
        });
        expect(deletedUser).toBeNull();

        // The Event survives, and reading it does not require the deleted
        // account - any signed-in user can, since visibility is PUBLIC.
        const afterDeletion = await bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .get(`/api/v1/events/${created.id}`)
            .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
            .expect(200),
        );
        // A terminal (FINISHED) Event organized by a User who then deletes
        // their account is auto-archived by
        // EventsService.closeOrganizedEventsForAccountDeletion.
        expect(afterDeletion.status).toBe('ARCHIVED');
        // The historical organizer name survives via the snapshot taken at
        // creation - but there is no live profile left: id and image are
        // both null (see event-organizer-ref.mapper.ts).
        expect(afterDeletion.organizer).toEqual({
          type: 'USER',
          id: null,
          name: 'Events Deletable Historical',
          image: null,
        });
      });

      it('a PUBLISHED Event whose organizer deletes their account is force-cancelled then archived - never left live with no organizer', async () => {
        const created = await createPersonalEvent(DELETABLE_PUBLISHED_TOKEN, {
          name: 'Published Organizer Deletion Event',
        });
        await publishEvent(DELETABLE_PUBLISHED_TOKEN, created.id);

        // The creator is also EventRole.OWNER by default - that (pre-
        // existing, unchanged) gate blocks account deletion outright while
        // it holds OWNER on a live Event (see
        // EventRolesService.findOwnedActiveEvents), independently of
        // organizerUser. Transferring OWNER away - to an otherwise
        // unrelated User, since a personal Event has no Community
        // membership to check (see EventRolesService.transferOwnership) -
        // clears that gate while leaving organizerUser exactly as it was;
        // this is the actual scenario closeOrganizedEventsForAccountDeletion
        // exists for (see its own comment).
        await request(app.getHttpServer())
          .post(`/api/v1/events/${created.id}/transfer-ownership`)
          .set('Authorization', `Bearer ${DELETABLE_PUBLISHED_TOKEN}`)
          .send({ toUserId: localUserIdByToken.get(OUTSIDER_TOKEN) })
          .expect(201);

        await request(app.getHttpServer())
          .delete('/api/v1/users/me')
          .set('Authorization', `Bearer ${DELETABLE_PUBLISHED_TOKEN}`)
          .expect(204);

        const em = app.get(EntityManager).fork();
        const deletedUser = await em.findOne(User, {
          clerkUserId: DELETABLE_PUBLISHED_CLERK_ID,
        });
        expect(deletedUser).toBeNull();

        const afterDeletion = await bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .get(`/api/v1/events/${created.id}`)
            .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
            .expect(200),
        );
        expect(afterDeletion.status).toBe('ARCHIVED');
        expect(afterDeletion.organizer).toEqual({
          type: 'USER',
          id: null,
          name: 'Events Deletable Published',
          image: null,
        });
      });

      it('still blocks account deletion while the organizer also holds EventRole.OWNER on a live Event - the pre-existing gate is untouched by the organizer-snapshot model', async () => {
        const created = await createPersonalEvent(DELETABLE_STILL_OWNER_TOKEN, {
          name: 'Still Owner Blocks Deletion',
        });
        await publishEvent(DELETABLE_STILL_OWNER_TOKEN, created.id);

        const blocked = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .delete('/api/v1/users/me')
            .set('Authorization', `Bearer ${DELETABLE_STILL_OWNER_TOKEN}`)
            .expect(409),
        );
        expect(blocked.code).toBe('CANNOT_DELETE_ACCOUNT_OWNS_EVENTS');

        // Blocked before anything is touched - the account, and the Event,
        // are both still exactly as they were.
        const em = app.get(EntityManager).fork();
        const stillThere = await em.findOne(User, {
          clerkUserId: DELETABLE_STILL_OWNER_CLERK_ID,
        });
        expect(stillThere).not.toBeNull();

        const stillPublished = await bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .get(`/api/v1/events/${created.id}`)
            .set('Authorization', `Bearer ${DELETABLE_STILL_OWNER_TOKEN}`)
            .expect(200),
        );
        expect(stillPublished.status).toBe('PUBLISHED');
      });
    });
  });
});
