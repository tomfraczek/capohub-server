/**
 * E2E tests for the career-timeline module: read-time aggregation of
 * START_TRAINING/JOINED_GROUP/LEFT_GROUP/RECEIVED_RANK/STARTED_TEACHING/
 * STARTED_SECTION/FOUNDED_GROUP (all SYSTEM, built fresh from existing
 * sources - User, FormalGroupAffiliation, FormalRankAssignment,
 * RoleAssignment) plus MANUAL entries (CareerTimelineEntry, any of the 12
 * types).
 *
 * Scenarios:
 *  1. A full timeline for one user aggregates every SYSTEM type correctly,
 *     sorted descending by occurredOn, mixed with a MANUAL entry - and
 *     there is no automatic per-Event entry any more (redesign spec
 *     §1/§23: Career History is not an activity feed).
 *  2. The `types` query filter restricts the result to only the requested
 *     types.
 *  3. `limit`/`offset` paginate correctly, with accurate total/hasMore.
 *  4. A non-owner viewer sees nothing until showCareerTimeline=true, and
 *     even then each type stays gated by its own underlying privacy toggle
 *     (showFormalGroup/showFormalRank).
 *  5. FOUNDED_GROUP/STARTED_TEACHING are derived correctly from
 *     RoleAssignment (OWNER at group creation / INSTRUCTOR grant).
 *  6. Manual entries: full CRUD across representative types (OTHER,
 *     BATIZADO linked to a real Event, RECEIVED_APELIDO), occurredOn-in-
 *     the-future rejection, and IDOR (invisible/unusable to anyone but the
 *     owner). A SYSTEM item's id can never be edited/deleted through this
 *     endpoint - it simply isn't a row this endpoint owns.
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
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import { RankResponseDto } from '../src/graduation/dto/rank-response.dto';
import { FormalRankAssignmentResponseDto } from '../src/graduation/dto/formal-rank-assignment-response.dto';
import { GraduationSystem } from '../src/graduation/entities/graduation-system.entity';
import { Rank } from '../src/graduation/entities/rank.entity';
import { FormalRankAssignment } from '../src/graduation/entities/formal-rank-assignment.entity';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { EventGuardianAssignment } from '../src/events/entities/event-guardian-assignment.entity';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';
import { CareerTimelineEntry } from '../src/career-timeline/entities/career-timeline-entry.entity';
import {
  CareerTimelineEntryType,
  CareerTimelineOrigin,
} from '../src/career-timeline/enums/career-timeline-entry-type.enum';
import { CareerTimelineResponseDto } from '../src/career-timeline/dto/career-timeline-response.dto';
import { CareerTimelineItemDto } from '../src/career-timeline/dto/career-timeline-item.dto';

const OWNER_TOKEN = 'valid-ctl-owner-token';
const MEMBER_TOKEN = 'valid-ctl-member-token';
const VIEWER_TOKEN = 'valid-ctl-viewer-token';
const OTHER_MEMBER_TOKEN = 'valid-ctl-other-member-token';
const OUTSIDER_TOKEN = 'valid-ctl-outsider-token';

const TOKENS = [
  OWNER_TOKEN,
  MEMBER_TOKEN,
  VIEWER_TOKEN,
  OTHER_MEMBER_TOKEN,
  OUTSIDER_TOKEN,
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

function oneSegment(colorHex = '#123456') {
  return [{ position: 1, colorHex, proportion: 100 }];
}

describe('Career Timeline (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const createdEventIds: string[] = [];
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

    for (const token of TOKENS) {
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
      const eventInCommunity = {
        event: {
          $or: [
            { communityGroup: { $in: createdGroupIds } },
            { communitySection: { $in: createdGroupIds } },
          ],
        },
      };
      await cleanup.nativeDelete(CareerTimelineEntry, {
        user: { $in: [...localUserIdByToken.values()] },
      });
      // FormalRankAssignment.event has deleteRule 'no action' - must be
      // cleared before the Events themselves are deleted below.
      await cleanup.nativeDelete(FormalRankAssignment, {
        user: { $in: [...localUserIdByToken.values()] },
      });
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

      const systems = await cleanup.find(GraduationSystem, {
        group: { $in: createdGroupIds },
      });
      const systemIds = systems.map((s) => s.id);
      await cleanup.nativeDelete(Rank, { system: { $in: systemIds } });
      await cleanup.nativeDelete(GraduationSystem, {
        group: { $in: createdGroupIds },
      });

      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
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

  // ─── Fixture helpers ─────────────────────────────────────────────────────

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Career Timeline Test Group',
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

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Career Timeline Test Section',
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

  async function createSection(
    token: string,
    parentId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function joinSection(
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

  async function grantSectionRole(
    granterToken: string,
    sectionId: string,
    userToken: string,
    role: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/role-assignments`)
      .set('Authorization', `Bearer ${granterToken}`)
      .send({ userId: localUserIdByToken.get(userToken), role })
      .expect(201);
  }

  async function grantGroupRole(
    granterToken: string,
    groupId: string,
    userToken: string,
    role: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${granterToken}`)
      .send({ userId: localUserIdByToken.get(userToken), role })
      .expect(201);
  }

  async function transferGroupOwnership(
    currentOwnerToken: string,
    groupId: string,
    newOwnerToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/transfer-ownership`)
      .set('Authorization', `Bearer ${currentOwnerToken}`)
      .send({ newOwnerUserId: localUserIdByToken.get(newOwnerToken) })
      .expect(201);
  }

  async function setFormalGroup(
    token: string,
    groupId: string,
    startedOn?: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`)
      .send(startedOn ? { groupId, startedOn } : { groupId })
      .expect(200);
  }

  async function endFormalGroup(token: string): Promise<void> {
    await request(app.getHttpServer())
      .delete('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  }

  async function createGroupWithCatalog(token: string): Promise<{
    group: GroupResponseDto;
    section: SectionResponseDto;
    rank: RankResponseDto;
  }> {
    const group = await createGroup(token, {
      name: `Career Timeline Catalog Group ${Date.now()}-${Math.random()}`,
    });
    const section = await createSection(token, group.id);
    await bodyOf<GraduationSystemResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/graduation-system`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'System' })
        .expect(201),
    );
    const rank = await bodyOf<RankResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          track: RankTrack.ADULT,
          name: 'Corda Crua',
          description: null,
          previousRankId: null,
          cordSegments: oneSegment(),
        })
        .expect(201),
    );
    return { group, section, rank };
  }

  async function setFormalRank(
    token: string,
    rankId: string,
    extra: Record<string, unknown> = {},
    expectStatus = 200,
  ): Promise<FormalRankAssignmentResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .put('/api/v1/users/me/formal-rank')
        .set('Authorization', `Bearer ${token}`)
        .send({ rankId, ...extra })
        .expect(expectStatus),
    );
  }

  function eventPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: 'FESTIVAL',
      customTypeLabel: null,
      name: 'Career Timeline Test Event',
      description: 'A career-timeline e2e fixture event',
      coverImageUrl: null,
      // Created in the future so self-registration succeeds (registration
      // requires status PUBLISHED, and an already-past endsAt would be
      // lazily reconciled to FINISHED on the very next read) - pushed into
      // the past afterwards via a direct DB update, see
      // pushEventIntoThePast.
      startsAt: '2099-01-10T10:00:00.000Z',
      endsAt: '2099-01-10T18:00:00.000Z',
      locationName: 'Main hall',
      locationAddress: null,
      visibility: EventVisibility.PUBLIC,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  async function createEvent(
    token: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    const created = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send(eventPayload(overrides))
        .expect(201),
    );
    createdEventIds.push(created.id);
    return created;
  }

  async function publishEvent(token: string, eventId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  async function pushEventIntoThePast(
    eventId: string,
    startsAt: string,
    endsAt: string,
  ): Promise<void> {
    const em = app.get(EntityManager).fork();
    await em.nativeUpdate(
      Event,
      { id: eventId },
      { startsAt: new Date(startsAt), endsAt: new Date(endsAt) },
    );
  }

  async function patchOwnProfile(
    token: string,
    body: Record<string, unknown>,
  ): Promise<UserProfileResponseDto> {
    return bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200),
    );
  }

  async function getTimeline(
    token: string,
    userId: string,
    query = '',
  ): Promise<CareerTimelineResponseDto> {
    return bodyOf<CareerTimelineResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/users/${userId}/career-timeline${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function getOwnTimeline(
    token: string,
    query = '',
  ): Promise<CareerTimelineResponseDto> {
    return bodyOf<CareerTimelineResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/users/me/career-timeline${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  // ─── Full aggregation + sorting ─────────────────────────────────────────

  describe('GET /users/me/career-timeline - full aggregation', () => {
    let memberId: string;
    let group1: GroupResponseDto;
    let group2: GroupResponseDto;
    let rank2: RankResponseDto;
    let linkedEvent: EventResponseDto;

    beforeAll(async () => {
      memberId = localUserIdByToken.get(MEMBER_TOKEN)!;

      await patchOwnProfile(MEMBER_TOKEN, {
        capoeiraStartedAt: '2010-01-01',
        showCapoeiraStartedAt: true,
      });

      const catalog1 = await createGroupWithCatalog(OWNER_TOKEN);
      group1 = catalog1.group;
      await joinSection(OWNER_TOKEN, catalog1.section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group1.id, '2015-01-01');
      await endFormalGroup(MEMBER_TOKEN);

      const catalog2 = await createGroupWithCatalog(OWNER_TOKEN);
      group2 = catalog2.group;
      rank2 = catalog2.rank;
      await joinSection(OWNER_TOKEN, catalog2.section.id, MEMBER_TOKEN);
      await setFormalGroup(MEMBER_TOKEN, group2.id, '2018-01-01');

      linkedEvent = await createEvent(OWNER_TOKEN, catalog2.section.id, {
        name: 'Batizado (linked to rank)',
      });
      await publishEvent(OWNER_TOKEN, linkedEvent.id);
      await pushEventIntoThePast(
        linkedEvent.id,
        '2019-06-01T10:00:00.000Z',
        '2019-06-01T18:00:00.000Z',
      );

      await setFormalRank(MEMBER_TOKEN, rank2.id, {
        startedOn: '2019-01-01',
        eventId: linkedEvent.id,
      });

      await request(app.getHttpServer())
        .post('/api/v1/users/me/career-timeline-entries')
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({
          type: CareerTimelineEntryType.OTHER,
          occurredOn: '2021-06-01',
          title: 'My personal note',
          description: 'A private milestone',
        })
        .expect(201);
    });

    it('aggregates every SYSTEM type, sorts descending, and never builds a bare per-Event item', async () => {
      const result = await getOwnTimeline(MEMBER_TOKEN);

      expect(result.total).toBe(6);
      expect(result.items).toHaveLength(6);

      const dates = result.items.map((item) => item.occurredOn);
      expect(dates).toEqual([...dates].sort().reverse());

      const types = result.items.map((item) => item.type);
      expect(
        types.filter((t) => t === CareerTimelineEntryType.START_TRAINING),
      ).toHaveLength(1);
      expect(
        types.filter((t) => t === CareerTimelineEntryType.JOINED_GROUP),
      ).toHaveLength(2);
      expect(
        types.filter((t) => t === CareerTimelineEntryType.LEFT_GROUP),
      ).toHaveLength(1);
      expect(
        types.filter((t) => t === CareerTimelineEntryType.RECEIVED_RANK),
      ).toHaveLength(1);
      expect(
        types.filter((t) => t === CareerTimelineEntryType.OTHER),
      ).toHaveLength(1);
      // No standalone EVENT-shaped item at all - see the module's own
      // comment on why that category was removed.
      expect(result.items.some((item) => item.id.startsWith('event:'))).toBe(
        false,
      );

      const rankItem = result.items.find(
        (item) => item.type === CareerTimelineEntryType.RECEIVED_RANK,
      )!;
      expect(rankItem.origin).toBe('SYSTEM');
      expect(rankItem.rankDetails).not.toBeNull();
      expect(rankItem.event?.eventId).toBe(linkedEvent.id);
    });

    it('filters via the comma-separated `types` query param', async () => {
      const result = await getOwnTimeline(
        MEMBER_TOKEN,
        `?types=${CareerTimelineEntryType.RECEIVED_RANK},${CareerTimelineEntryType.OTHER}`,
      );

      const types = result.items.map((item) => item.type).sort();
      expect(types).toEqual(
        [
          CareerTimelineEntryType.RECEIVED_RANK,
          CareerTimelineEntryType.OTHER,
        ].sort(),
      );
    });

    it('paginates with limit/offset and reports total/hasMore accurately', async () => {
      const page1 = await getOwnTimeline(MEMBER_TOKEN, '?limit=3&offset=0');
      expect(page1.items).toHaveLength(3);
      expect(page1.total).toBe(6);
      expect(page1.hasMore).toBe(true);

      const page3 = await getOwnTimeline(MEMBER_TOKEN, '?limit=3&offset=3');
      expect(page3.items).toHaveLength(3);
      expect(page3.hasMore).toBe(false);
    });

    // ─── Privacy for a non-owner viewer ───────────────────────────────────

    it('progressively reveals types to a non-owner viewer as the target opts each one in', async () => {
      const empty = await getTimeline(VIEWER_TOKEN, memberId);
      expect(empty).toEqual({ items: [], total: 0, hasMore: false });

      await patchOwnProfile(MEMBER_TOKEN, { showCareerTimeline: true });
      const afterCareerTimeline = await getTimeline(VIEWER_TOKEN, memberId);
      const typesAfterCareerTimeline = afterCareerTimeline.items.map(
        (item) => item.type,
      );
      expect(typesAfterCareerTimeline.sort()).toEqual(
        [
          CareerTimelineEntryType.START_TRAINING,
          CareerTimelineEntryType.OTHER,
        ].sort(),
      );

      await patchOwnProfile(MEMBER_TOKEN, { showFormalGroup: true });
      const afterFormalGroup = await getTimeline(VIEWER_TOKEN, memberId);
      expect(
        afterFormalGroup.items.some(
          (item) => item.type === CareerTimelineEntryType.JOINED_GROUP,
        ),
      ).toBe(true);
      expect(
        afterFormalGroup.items.some(
          (item) => item.type === CareerTimelineEntryType.RECEIVED_RANK,
        ),
      ).toBe(false);

      await patchOwnProfile(MEMBER_TOKEN, { showFormalRank: true });
      const full = await getTimeline(VIEWER_TOKEN, memberId);
      expect(full.total).toBe(6);
      expect(full.items.map((item) => item.type).sort()).toEqual(
        (await getOwnTimeline(MEMBER_TOKEN)).items
          .map((item) => item.type)
          .sort(),
      );
    });
  });

  // ─── FOUNDED_GROUP (Group.founderUser) / STARTED_TEACHING (RoleAssignment) ─

  describe('FOUNDED_GROUP / STARTED_TEACHING', () => {
    it('credits the creator with FOUNDED_GROUP, dated at group creation', async () => {
      const before = await getOwnTimeline(OWNER_TOKEN);
      const foundedBefore = before.items.filter(
        (item) => item.type === CareerTimelineEntryType.FOUNDED_GROUP,
      ).length;

      const group = await createGroup(OWNER_TOKEN, {
        name: `Founder Test Group ${Date.now()}`,
      });

      const after = await getOwnTimeline(OWNER_TOKEN);
      const founded = after.items.filter(
        (item) => item.type === CareerTimelineEntryType.FOUNDED_GROUP,
      );
      expect(founded.length).toBe(foundedBefore + 1);
      expect(founded.some((item) => item.group?.groupId === group.id)).toBe(
        true,
      );
    });

    // Regression test for the founder-persistence fix: FOUNDED_GROUP used to
    // be re-derived from the earliest-ever OWNER RoleAssignment, which
    // silently moved to whoever ownership was transferred to. It now reads
    // Group.founderUser - a permanent record set once at creation - so the
    // original creator keeps their FOUNDED_GROUP credit even after they stop
    // being OWNER. (The other half of the original bug - the founder's
    // RoleAssignment row being physically deleted on account deletion - is
    // covered at the unit level, in career-timeline-aggregation.service.spec.ts,
    // since deleting a fixture account here would break every other test in
    // this file that shares it.)
    it('keeps crediting the original creator with FOUNDED_GROUP after ownership is transferred away, and never credits the new owner', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: `Transferred Group ${Date.now()}`,
      });
      await grantGroupRole(OWNER_TOKEN, group.id, OTHER_MEMBER_TOKEN, 'ADMIN');
      await transferGroupOwnership(OWNER_TOKEN, group.id, OTHER_MEMBER_TOKEN);

      const originalCreatorTimeline = await getOwnTimeline(OWNER_TOKEN);
      expect(
        originalCreatorTimeline.items.some(
          (item) =>
            item.type === CareerTimelineEntryType.FOUNDED_GROUP &&
            item.group?.groupId === group.id,
        ),
      ).toBe(true);

      const newOwnerTimeline = await getOwnTimeline(OTHER_MEMBER_TOKEN);
      expect(
        newOwnerTimeline.items.some(
          (item) =>
            item.type === CareerTimelineEntryType.FOUNDED_GROUP &&
            item.group?.groupId === group.id,
        ),
      ).toBe(false);
    });

    it('credits a granted INSTRUCTOR with STARTED_TEACHING on that Section', async () => {
      const group = await createGroup(OWNER_TOKEN, {
        name: `Teaching Test Group ${Date.now()}`,
      });
      const section = await createSection(OWNER_TOKEN, group.id);
      await joinSection(OWNER_TOKEN, section.id, OTHER_MEMBER_TOKEN);
      await grantSectionRole(
        OWNER_TOKEN,
        section.id,
        OTHER_MEMBER_TOKEN,
        'INSTRUCTOR',
      );

      const timeline = await getOwnTimeline(OTHER_MEMBER_TOKEN);
      const teaching = timeline.items.find(
        (item) =>
          item.type === CareerTimelineEntryType.STARTED_TEACHING &&
          item.section?.sectionId === section.id,
      );
      expect(teaching).toBeDefined();
      expect(teaching!.origin).toBe('SYSTEM');
    });
  });

  // ─── Linked-Event snapshot & visibility (audit §3) ─────────────────────

  describe('linked Event snapshot and visibility', () => {
    it("keeps showing the Event's original name/location after it is edited, but not its current values", async () => {
      const catalog = await createGroupWithCatalog(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, catalog.section.id, {
        name: 'Festival Capoeira 2022',
        locationName: 'Poznań',
        visibility: EventVisibility.PUBLIC,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const created = await bodyOf<CareerTimelineItemDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/career-timeline-entries')
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .send({
            type: CareerTimelineEntryType.IMPORTANT_EVENT,
            occurredOn: '2022-06-15',
            title: 'Festival Capoeira 2022',
            eventId: event.id,
          })
          .expect(201),
      );
      expect(created.event).toMatchObject({
        title: 'Festival Capoeira 2022',
        locationName: 'Poznań',
      });

      // The organizer renames and relocates the Event years later.
      const em = app.get(EntityManager).fork();
      await em.nativeUpdate(
        Event,
        { id: event.id },
        {
          name: 'Festival Capoeira 2022 (rebranded)',
          locationName: 'Warszawa',
        },
      );

      const timeline = await getOwnTimeline(OTHER_MEMBER_TOKEN);
      const item = timeline.items.find((i) => i.id === created.id)!;
      expect(item.event).toMatchObject({
        eventId: event.id,
        title: 'Festival Capoeira 2022',
        locationName: 'Poznań',
      });
    });

    it("hides a linked private Event's own details from a viewer who has no access to it, without hiding the career-timeline fact", async () => {
      const catalog = await createGroupWithCatalog(OWNER_TOKEN);
      const privateEvent = await createEvent(OWNER_TOKEN, catalog.section.id, {
        name: 'Members-only Batizado',
        visibility: EventVisibility.COMMUNITY_MEMBERS,
      });
      await publishEvent(OWNER_TOKEN, privateEvent.id);
      // OTHER_MEMBER_TOKEN links it themselves - linking never required the
      // caller to have access to the Event (see resolveEvent), only that it
      // exists.
      await joinSection(OWNER_TOKEN, catalog.section.id, OTHER_MEMBER_TOKEN);

      const created = await bodyOf<CareerTimelineItemDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/career-timeline-entries')
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .send({
            type: CareerTimelineEntryType.BATIZADO,
            occurredOn: '2023-01-01',
            eventId: privateEvent.id,
          })
          .expect(201),
      );
      expect(created.event).not.toBeNull();

      await patchOwnProfile(OTHER_MEMBER_TOKEN, { showCareerTimeline: true });

      // OUTSIDER_TOKEN is not a member of catalog.section - COMMUNITY_MEMBERS
      // visibility must hide the Event's own details from them.
      const otherMemberId = localUserIdByToken.get(OTHER_MEMBER_TOKEN)!;
      const timelineForOutsider = await getTimeline(
        OUTSIDER_TOKEN,
        otherMemberId,
      );
      const itemForOutsider = timelineForOutsider.items.find(
        (i) => i.id === created.id,
      )!;
      expect(itemForOutsider).toBeDefined();
      expect(itemForOutsider.title).toBe('Batizado');
      expect(itemForOutsider.event).toBeNull();

      // The owner always sees their own linked Event regardless.
      const ownTimeline = await getOwnTimeline(OTHER_MEMBER_TOKEN);
      expect(
        ownTimeline.items.find((i) => i.id === created.id)!.event,
      ).not.toBeNull();
    });
  });

  // ─── Possible MANUAL/SYSTEM duplicates (audit §2) ───────────────────────

  describe('possibleDuplicateOfId', () => {
    it('flags a MANUAL RECEIVED_RANK entry as a possible duplicate once a matching SYSTEM RECEIVED_RANK is recorded for the same date', async () => {
      const catalog = await createGroupWithCatalog(OWNER_TOKEN);

      const created = await bodyOf<CareerTimelineItemDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/career-timeline-entries')
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .send({
            type: CareerTimelineEntryType.RECEIVED_RANK,
            occurredOn: '2023-06-01',
            rankName: 'Corda Crua',
          })
          .expect(201),
      );
      expect(created.possibleDuplicateOfId).toBeNull();

      await joinSection(OWNER_TOKEN, catalog.section.id, OUTSIDER_TOKEN);
      await setFormalRank(OUTSIDER_TOKEN, catalog.rank.id, {
        startedOn: '2023-06-01',
      });

      const timeline = await getOwnTimeline(OUTSIDER_TOKEN);
      const manualItem = timeline.items.find((i) => i.id === created.id)!;
      const systemItem = timeline.items.find(
        (i) =>
          i.type === CareerTimelineEntryType.RECEIVED_RANK &&
          i.origin === CareerTimelineOrigin.SYSTEM,
      )!;
      expect(manualItem.possibleDuplicateOfId).toBe(systemItem.id);
      // Nothing about the MANUAL entry itself is touched - still there, own
      // title intact, still editable.
      expect(manualItem.editable).toBe(true);
      expect(manualItem.title).toBe('Otrzymanie stopnia Corda Crua');
    });
  });

  // ─── Manual entries CRUD + IDOR ─────────────────────────────────────────

  describe('/users/me/career-timeline-entries', () => {
    async function createEntry(
      token: string,
      overrides: Record<string, unknown> = {},
      expectStatus = 201,
    ): Promise<CareerTimelineItemDto | HttpErrorResponse> {
      return bodyOf(
        request(app.getHttpServer())
          .post('/api/v1/users/me/career-timeline-entries')
          .set('Authorization', `Bearer ${token}`)
          .send({
            type: CareerTimelineEntryType.OTHER,
            occurredOn: '2022-03-15',
            title: 'First roda',
            description: 'My very first roda',
            ...overrides,
          })
          .expect(expectStatus),
      );
    }

    it('creates, reads, updates and deletes a manual OTHER entry, appearing/disappearing from the aggregated timeline', async () => {
      const created = (await createEntry(
        OTHER_MEMBER_TOKEN,
      )) as CareerTimelineItemDto;
      expect(created.type).toBe(CareerTimelineEntryType.OTHER);
      expect(created.origin).toBe('MANUAL');
      expect(created.editable).toBe(true);
      expect(created.title).toBe('First roda');

      const fetched = await bodyOf<CareerTimelineItemDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/career-timeline-entries/${created.id}`)
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.id).toBe(created.id);

      const timeline = await getOwnTimeline(OTHER_MEMBER_TOKEN);
      expect(timeline.items.some((item) => item.id === created.id)).toBe(true);

      const updated = await bodyOf<CareerTimelineItemDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/career-timeline-entries/${created.id}`)
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .send({
            type: CareerTimelineEntryType.OTHER,
            occurredOn: '2022-04-01',
            title: 'Updated title',
            description: null,
          })
          .expect(200),
      );
      expect(updated.title).toBe('Updated title');
      expect(updated.description).toBeNull();

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/career-timeline-entries/${created.id}`)
        .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/users/me/career-timeline-entries/${created.id}`)
        .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
        .expect(404);
    });

    it('creates a BATIZADO entry linked to a real CapoHub Event, with the event ref resolved on read', async () => {
      const catalog = await createGroupWithCatalog(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, catalog.section.id, {
        name: 'Batizado Anual',
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const created = (await createEntry(OTHER_MEMBER_TOKEN, {
        type: CareerTimelineEntryType.BATIZADO,
        occurredOn: '2023-08-20',
        eventId: event.id,
        title: undefined,
      })) as CareerTimelineItemDto;

      expect(created.title).toBe('Batizado');
      expect(created.event?.eventId).toBe(event.id);
    });

    it('creates a RECEIVED_APELIDO entry with the apelido baked into the generated title', async () => {
      const created = (await createEntry(OTHER_MEMBER_TOKEN, {
        type: CareerTimelineEntryType.RECEIVED_APELIDO,
        occurredOn: '2018-01-01',
        apelido: 'Trovão',
        title: undefined,
      })) as CareerTimelineItemDto;

      expect(created.title).toBe('Otrzymanie apelido „Trovão”');
      expect(created.apelido).toBe('Trovão');
    });

    it('accepts a YEAR-only partial date and reports its precision back', async () => {
      const created = (await createEntry(OTHER_MEMBER_TOKEN, {
        occurredOn: '2013',
      })) as CareerTimelineItemDto;

      expect(created.occurredOn).toBe('2013-01-01');
      expect(created.occurredOnPrecision).toBe('YEAR');
    });

    it('rejects an occurredOn in the future', async () => {
      const error = (await createEntry(
        OTHER_MEMBER_TOKEN,
        { occurredOn: '2099-01-01' },
        400,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(400);
    });

    it('IDOR: a manual entry is invisible and unusable to anyone but its owner', async () => {
      const entry = (await createEntry(OUTSIDER_TOKEN, {
        title: 'Private entry',
      })) as CareerTimelineItemDto;

      const getError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/career-timeline-entries/${entry.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(getError.statusCode).toBe(404);

      const patchError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/career-timeline-entries/${entry.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({
            type: CareerTimelineEntryType.OTHER,
            occurredOn: '2022-01-01',
            title: 'Hijacked',
            description: null,
          })
          .expect(404),
      );
      expect(patchError.statusCode).toBe(404);

      const deleteError = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/users/me/career-timeline-entries/${entry.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(404),
      );
      expect(deleteError.statusCode).toBe(404);

      const memberTimeline = await getOwnTimeline(MEMBER_TOKEN);
      expect(memberTimeline.items.some((item) => item.id === entry.id)).toBe(
        false,
      );
    });

    it('cannot edit or delete a SYSTEM item through the manual-entries endpoint - it is not a row this endpoint owns', async () => {
      const timeline = await getOwnTimeline(MEMBER_TOKEN);
      const systemItem = timeline.items.find(
        (item) => item.origin === CareerTimelineOrigin.SYSTEM,
      );
      expect(systemItem).toBeDefined();

      await request(app.getHttpServer())
        .patch(`/api/v1/users/me/career-timeline-entries/${systemItem!.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({
          type: CareerTimelineEntryType.OTHER,
          occurredOn: '2022-01-01',
          title: 'Attempted tamper',
        })
        .expect(400); // not a valid UUID (SYSTEM ids are composite strings) - rejected before it could ever be found

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/career-timeline-entries/${systemItem!.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(400);
    });
  });
});
