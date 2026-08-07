/**
 * E2E tests for the career-timeline module: read-time aggregation of
 * CAPOEIRA_START/FORMAL_GROUP_JOINED/FORMAL_GROUP_LEFT/FORMAL_RANK/EVENT
 * from existing sources, plus manual CUSTOM entries (CareerTimelineEntry).
 *
 * Scenarios:
 *  1. A full timeline for one user aggregates every automatic category
 *     correctly, sorted descending by occurredOn, and an Event linked to a
 *     FormalRankAssignment produces exactly one FORMAL_RANK item (never a
 *     duplicate EVENT item for that same Event)
 *  2. The `categories` query filter restricts the result to only the
 *     requested categories
 *  3. `limit`/`offset` paginate correctly, with accurate total/hasMore
 *  4. A non-owner viewer sees nothing until showCareerTimeline=true, and
 *     even then each category stays gated by its own underlying privacy
 *     toggle (showFormalGroup/showFormalRank/showEventParticipation)
 *  5. Manual timeline entries: full CRUD, occurredOn-in-the-future
 *     rejection, and IDOR (invisible/unusable to anyone but the owner)
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
import { EventAttendeeResponseDto } from '../src/events/dto/event-attendee-response.dto';
import { EventGuardianAssignment } from '../src/events/entities/event-guardian-assignment.entity';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';
import { CareerTimelineEntry } from '../src/career-timeline/entities/career-timeline-entry.entity';
import { CareerTimelineCategory } from '../src/career-timeline/enums/career-timeline-category.enum';
import { CareerTimelineResponseDto } from '../src/career-timeline/dto/career-timeline-response.dto';
import { CustomTimelineItemDto } from '../src/career-timeline/dto/career-timeline-item.dto';

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
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
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
      latitude: null,
      longitude: null,
      visibility: EventVisibility.COMMUNITY_MEMBERS,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  // Events are created under the Section, not the parent Group: Event
  // COMMUNITY_MEMBERS visibility/registration requires membership on the
  // *exact* community the Event belongs to (RoleAssignmentsService.
  // isCommunityMember - a Group's membership means a RoleAssignment on that
  // exact Group, never inherited from a child Section membership), and
  // MEMBER_TOKEN in this file only ever holds a SectionMembership, not a
  // Group-level RoleAssignment.
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

  async function registerForEvent(
    token: string,
    eventId: string,
  ): Promise<EventAttendeeResponseDto[]> {
    return bodyOf<EventAttendeeResponseDto[]>(
      request(app.getHttpServer())
        .post(`/api/v1/events/${eventId}/register`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attendSelf: true, children: [] })
        .expect(201),
    );
  }

  /**
   * Pushes an already-published, already-attended Event's dates directly
   * into the past via the DB, bypassing the create/register-time "must not
   * be in the future" ordering constraint (see createEvent/eventPayload) so
   * the career timeline sees it as "has started or finished".
   */
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

  // ─── Full aggregation + dedup + sorting ────────────────────────────────

  describe('GET /users/me/career-timeline - full aggregation', () => {
    let memberId: string;
    let group1: GroupResponseDto;
    let group2: GroupResponseDto;
    let rank2: RankResponseDto;
    let linkedEvent: EventResponseDto;
    let plainEvent: EventResponseDto;

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
      await registerForEvent(MEMBER_TOKEN, linkedEvent.id);
      await pushEventIntoThePast(
        linkedEvent.id,
        '2019-06-01T10:00:00.000Z',
        '2019-06-01T18:00:00.000Z',
      );

      await setFormalRank(MEMBER_TOKEN, rank2.id, {
        startedOn: '2019-01-01',
        eventId: linkedEvent.id,
      });

      // PUBLIC (not COMMUNITY_MEMBERS): isolates the showEventParticipation
      // privacy-toggle assertion below from EventAccessService's own
      // membership-based visibility rule - VIEWER_TOKEN never joins this
      // Section, so a COMMUNITY_MEMBERS Event would stay invisible to it
      // regardless of the toggle, which would test the wrong thing.
      plainEvent = await createEvent(OWNER_TOKEN, catalog2.section.id, {
        name: 'Roda (not linked to any rank)',
        visibility: EventVisibility.PUBLIC,
      });
      await publishEvent(OWNER_TOKEN, plainEvent.id);
      await registerForEvent(MEMBER_TOKEN, plainEvent.id);
      await pushEventIntoThePast(
        plainEvent.id,
        '2020-06-01T10:00:00.000Z',
        '2020-06-01T18:00:00.000Z',
      );

      await bodyOf<CustomTimelineItemDto>(
        request(app.getHttpServer())
          .post('/api/v1/users/me/career-timeline-entries')
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({
            occurredOn: '2021-06-01',
            title: 'My personal note',
            description: 'A private milestone',
          })
          .expect(201),
      );
    });

    it('aggregates every category, deduplicates the rank-linked Event, and sorts descending', async () => {
      const result = await getOwnTimeline(MEMBER_TOKEN);

      expect(result.total).toBe(7);
      expect(result.items).toHaveLength(7);

      // Descending by occurredOn.
      const dates = result.items.map((item) => item.occurredOn);
      const sorted = [...dates].sort().reverse();
      expect(dates).toEqual(sorted);

      const categories = result.items.map((item) => item.category);
      expect(
        categories.filter((c) => c === CareerTimelineCategory.EVENT),
      ).toHaveLength(1);
      expect(
        categories.filter((c) => c === CareerTimelineCategory.FORMAL_RANK),
      ).toHaveLength(1);
      expect(
        categories.filter(
          (c) => c === CareerTimelineCategory.FORMAL_GROUP_JOINED,
        ),
      ).toHaveLength(2);
      expect(
        categories.filter(
          (c) => c === CareerTimelineCategory.FORMAL_GROUP_LEFT,
        ),
      ).toHaveLength(1);
      expect(
        categories.filter((c) => c === CareerTimelineCategory.CAPOEIRA_START),
      ).toHaveLength(1);
      expect(
        categories.filter((c) => c === CareerTimelineCategory.CUSTOM),
      ).toHaveLength(1);

      const eventItem = result.items.find(
        (item) => item.category === CareerTimelineCategory.EVENT,
      );
      expect(eventItem?.id).toBe(`event:${plainEvent.id}`);

      const rankItem = result.items.find(
        (item) => item.category === CareerTimelineCategory.FORMAL_RANK,
      );
      expect(rankItem?.id).toBe(
        `formal-rank:${(rankItem as { rank: { assignmentId: string } }).rank.assignmentId}`,
      );
      expect(
        (rankItem as unknown as { event: { eventId: string } | null }).event
          ?.eventId,
      ).toBe(linkedEvent.id);
    });

    it('filters by multiple categories via the comma-separated `categories` query param', async () => {
      const result = await getOwnTimeline(
        MEMBER_TOKEN,
        `?categories=${CareerTimelineCategory.FORMAL_RANK},${CareerTimelineCategory.EVENT}`,
      );

      const categories = result.items.map((item) => item.category).sort();
      expect(categories).toEqual(
        [
          CareerTimelineCategory.EVENT,
          CareerTimelineCategory.FORMAL_RANK,
        ].sort(),
      );
    });

    it('paginates with limit/offset and reports total/hasMore accurately', async () => {
      const page1 = await getOwnTimeline(MEMBER_TOKEN, '?limit=3&offset=0');
      expect(page1.items).toHaveLength(3);
      expect(page1.total).toBe(7);
      expect(page1.hasMore).toBe(true);

      const page3 = await getOwnTimeline(MEMBER_TOKEN, '?limit=3&offset=6');
      expect(page3.items).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });

    // ─── Privacy for a non-owner viewer ───────────────────────────────────

    it('progressively reveals categories to a non-owner viewer as the target opts each one in', async () => {
      const empty = await getTimeline(VIEWER_TOKEN, memberId);
      expect(empty).toEqual({ items: [], total: 0, hasMore: false });

      await patchOwnProfile(MEMBER_TOKEN, { showCareerTimeline: true });
      const afterCareerTimeline = await getTimeline(VIEWER_TOKEN, memberId);
      const categoriesAfterCareerTimeline = afterCareerTimeline.items.map(
        (item) => item.category,
      );
      expect(categoriesAfterCareerTimeline.sort()).toEqual(
        [
          CareerTimelineCategory.CAPOEIRA_START,
          CareerTimelineCategory.CUSTOM,
        ].sort(),
      );

      await patchOwnProfile(MEMBER_TOKEN, { showFormalGroup: true });
      const afterFormalGroup = await getTimeline(VIEWER_TOKEN, memberId);
      expect(
        afterFormalGroup.items.some(
          (item) =>
            item.category === CareerTimelineCategory.FORMAL_GROUP_JOINED,
        ),
      ).toBe(true);
      expect(
        afterFormalGroup.items.some(
          (item) => item.category === CareerTimelineCategory.FORMAL_RANK,
        ),
      ).toBe(false);

      await patchOwnProfile(MEMBER_TOKEN, { showFormalRank: true });
      const afterFormalRank = await getTimeline(VIEWER_TOKEN, memberId);
      expect(
        afterFormalRank.items.some(
          (item) => item.category === CareerTimelineCategory.FORMAL_RANK,
        ),
      ).toBe(true);
      expect(
        afterFormalRank.items.some(
          (item) => item.category === CareerTimelineCategory.EVENT,
        ),
      ).toBe(false);

      await patchOwnProfile(MEMBER_TOKEN, { showEventParticipation: true });
      const full = await getTimeline(VIEWER_TOKEN, memberId);
      expect(full.total).toBe(7);
      expect(full.items.map((item) => item.category).sort()).toEqual(
        (await getOwnTimeline(MEMBER_TOKEN)).items
          .map((item) => item.category)
          .sort(),
      );
    });
  });

  // ─── Manual entries CRUD + IDOR ─────────────────────────────────────────

  describe('/users/me/career-timeline-entries', () => {
    async function createEntry(
      token: string,
      overrides: Record<string, unknown> = {},
      expectStatus = 201,
    ): Promise<CustomTimelineItemDto | HttpErrorResponse> {
      return bodyOf(
        request(app.getHttpServer())
          .post('/api/v1/users/me/career-timeline-entries')
          .set('Authorization', `Bearer ${token}`)
          .send({
            occurredOn: '2022-03-15',
            title: 'First roda',
            description: 'My very first roda',
            ...overrides,
          })
          .expect(expectStatus),
      );
    }

    it('creates, reads, updates and deletes a manual entry, appearing/disappearing from the aggregated timeline', async () => {
      const created = (await createEntry(
        OTHER_MEMBER_TOKEN,
      )) as CustomTimelineItemDto;
      expect(created.category).toBe(CareerTimelineCategory.CUSTOM);
      expect(created.title).toBe('First roda');

      const fetched = await bodyOf<CustomTimelineItemDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/me/career-timeline-entries/${created.id}`)
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(fetched.id).toBe(created.id);

      const timeline = await getOwnTimeline(OTHER_MEMBER_TOKEN);
      expect(timeline.items.some((item) => item.id === created.id)).toBe(true);

      const updated = await bodyOf<CustomTimelineItemDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/career-timeline-entries/${created.id}`)
          .set('Authorization', `Bearer ${OTHER_MEMBER_TOKEN}`)
          .send({
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
      })) as CustomTimelineItemDto;

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

      // Never leaked into another user's own timeline either.
      const memberTimeline = await getOwnTimeline(MEMBER_TOKEN);
      expect(memberTimeline.items.some((item) => item.id === entry.id)).toBe(
        false,
      );
    });
  });
});
