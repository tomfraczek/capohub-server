/**
 * E2E tests for the graduation catalog (GraduationSystem + Rank + cord
 * segments), scoped to a root Group only.
 *
 * Scenarios:
 *  1. At most one active GraduationSystem per Group
 *  2. Only OWNER/ADMIN of the exact Group can manage the catalog
 *  3. A Section OWNER/ADMIN never gains catalog rights through membership
 *     or hierarchy
 *  4. CHILD and ADULT tracks are independent and returned separately, in
 *     pure gradation order (never alphabetical/createdAt)
 *  5. previousRank validation: self-reference, cycles, branching, a
 *     previousRank from another system, a previousRank from another track
 *  6. Cord segments: 1/2/many colors, matching/differing tips, wrong sum,
 *     bad hex
 *  7. Archive/restore
 *  8. Public read (GROUP_VIEW) - active ranks only, mutations stay closed
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
import { createFreshGroupOwner } from './fresh-group-owner.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import {
  RankResponseDto,
  RanksByTrackResponseDto,
} from '../src/graduation/dto/rank-response.dto';
import { PublicGraduationSystemResponseDto } from '../src/graduation/dto/public-graduation-system-response.dto';
import { GraduationSystem } from '../src/graduation/entities/graduation-system.entity';
import { Rank } from '../src/graduation/entities/rank.entity';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';

// No fixed "OWNER_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user, and this file needs an
// independent Group owner per call, so createGroupWithSystem()/
// createFreshGroup() mint one via createFreshGroupOwner instead.
const ADMIN_TOKEN = 'valid-grad-admin-token';
const SECTION_ADMIN_TOKEN = 'valid-grad-section-admin-token';
const OUTSIDER_TOKEN = 'valid-grad-outsider-token';

const TOKENS = [ADMIN_TOKEN, SECTION_ADMIN_TOKEN, OUTSIDER_TOKEN];

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

function oneSegment(overrides: Record<string, unknown> = {}) {
  return [{ position: 1, colorHex: '#FF0000', proportion: 100, ...overrides }];
}

describe('Graduation Catalog (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];

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
        .get('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      const systems = await cleanup.find(GraduationSystem, {
        group: { $in: createdGroupIds },
      });
      const systemIds = systems.map((s) => s.id);
      // rank_cord_segments cascades from ranks (deleteRule: 'cascade' - see
      // rank-cord-segment.entity.ts). Deleting every Rank row for these
      // systems in one statement is safe despite the self-referencing
      // previousRank FK - Postgres checks FK/unique constraints at the end
      // of the statement, not per-row, so the whole chain can go in one
      // DELETE without ever passing through an invalid intermediate state
      // (unlike nulling previousRank first, which - within one UPDATE -
      // would transiently give every rank in a chain previousRank = null
      // at once, violating "at most one first rank per system+track").
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
      // Must be read fresh here (not a stale snapshot taken at module load)
      // since createFreshGroup (via createFreshGroupOwner) registers a
      // fresh fixture user per call, mutating FIXTURE_CLERK_PROFILES in
      // place.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Graduation Test Group',
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
      name: 'Graduation Test Section',
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

  async function grantGroupAdmin(
    ownerToken: string,
    groupId: string,
    granteeToken: string,
  ): Promise<void> {
    const em = app.get(EntityManager).fork();
    const grantee = await em.findOneOrFail(User, {
      clerkUserId: TOKEN_TO_AUTH[granteeToken].userId,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: grantee.id, role: GroupRole.ADMIN })
      .expect(201);
  }

  async function grantSectionAdmin(
    ownerToken: string,
    groupId: string,
    sectionId: string,
    granteeToken: string,
  ): Promise<void> {
    const em = app.get(EntityManager).fork();
    const grantee = await em.findOneOrFail(User, {
      clerkUserId: TOKEN_TO_AUTH[granteeToken].userId,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: grantee.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: grantee.id, role: GroupRole.ADMIN })
      .expect(201);
    void groupId;
  }

  async function createSystem(
    token: string,
    groupId: string,
    expectStatus = 201,
  ): Promise<GraduationSystemResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/graduation-system`)
        .set('Authorization', `Bearer ${token}`)
        .expect(expectStatus),
    );
  }

  async function createRank(
    token: string,
    groupId: string,
    body: Record<string, unknown>,
    expectStatus = 201,
  ): Promise<RankResponseDto | HttpErrorResponse> {
    return bodyOf(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/ranks`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(expectStatus),
    );
  }

  function rankPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      track: RankTrack.ADULT,
      name: 'Corda Crua',
      description: null,
      previousRankId: null,
      cordSegments: oneSegment(),
      ...overrides,
    };
  }

  async function createFreshGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto & { token: string; userId: string }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'grad',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
  }

  async function createGroupWithSystem(): Promise<
    GroupResponseDto & { token: string; userId: string }
  > {
    const group = await createFreshGroup({
      name: `System Group ${Date.now()}-${Math.random()}`,
    });
    await createSystem(group.token, group.id);
    return group;
  }

  // ─── 1. one active system per group ─────────────────────────────────────

  describe('GraduationSystem', () => {
    it('allows exactly one active system per group', async () => {
      const group = await createFreshGroup({
        name: 'One System Group',
      });

      const created = (await createSystem(
        group.token,
        group.id,
      )) as GraduationSystemResponseDto;
      expect(created.isActive).toBe(true);
      expect(created.groupId).toBe(group.id);

      const conflict = (await createSystem(
        group.token,
        group.id,
        409,
      )) as HttpErrorResponse;
      expect(conflict.statusCode).toBe(409);
    });

    it('404s for a group that has no system yet - a valid, permanent state', async () => {
      const group = await createFreshGroup({ name: 'No System Group' });
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/graduation-system`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(404),
      );
      expect(error.statusCode).toBe(404);
    });

    it('no longer exposes a PATCH - the system has nothing editable', async () => {
      const group = await createGroupWithSystem();

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${group.id}/graduation-system`)
        .set('Authorization', `Bearer ${group.token}`)
        .send({ name: 'Renamed System' })
        .expect(404);
    });

    it('lets a Group ADMIN (not only OWNER) manage the catalog', async () => {
      const group = await createGroupWithSystem();
      await grantGroupAdmin(group.token, group.id, ADMIN_TOKEN);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send(rankPayload({ name: 'Admin rank' }))
        .expect(201);
    });

    it('rejects a Section OWNER/ADMIN managing the catalog - no inheritance through membership', async () => {
      const group = await createGroupWithSystem();
      const section = await createSection(group.token, group.id);
      await grantSectionAdmin(
        group.token,
        group.id,
        section.id,
        SECTION_ADMIN_TOKEN,
      );

      // A Section OWNER/ADMIN holds no RoleAssignment on the *root Group*
      // at all (only on the Section) - GroupPermissionsGuard.
      // resolveAuthorization therefore finds zero role assignments for
      // (SECTION_ADMIN_TOKEN, group.id) and returns 404, never a 403 that
      // would confirm the group's existence to a non-holder (see the
      // guard's own "404 not 403" documentation).
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/ranks`)
          .set('Authorization', `Bearer ${SECTION_ADMIN_TOKEN}`)
          .send(rankPayload({ name: 'Hijacked' }))
          .expect(404),
      );
      expect(error.statusCode).toBe(404);
    });

    it('rejects an outsider entirely (404, not 403 - never confirms the group exists to a non-holder)', async () => {
      const group = await createGroupWithSystem();
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/graduation-system`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(404),
      );
      expect(error.statusCode).toBe(404);
    });
  });

  // ─── Ranks: gradation chain ──────────────────────────────────────────────

  describe('Ranks - gradation chain', () => {
    it('returns CHILD and ADULT separately, each strictly in gradation order (never alphabetical)', async () => {
      const group = await createGroupWithSystem();

      const z = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'Z last' }),
      )) as RankResponseDto;
      const a = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'A middle', previousRankId: z.id }),
      )) as RankResponseDto;
      const m = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'M final', previousRankId: a.id }),
      )) as RankResponseDto;
      const child1 = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'Child first', track: RankTrack.CHILD }),
      )) as RankResponseDto;

      const list = await bodyOf<RanksByTrackResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/ranks`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(200),
      );

      expect(list[RankTrack.ADULT].map((r) => r.name)).toEqual([
        'Z last',
        'A middle',
        'M final',
      ]);
      expect(list[RankTrack.CHILD].map((r) => r.name)).toEqual(['Child first']);
      expect(list[RankTrack.ADULT][0].nextRankId).toBe(a.id);
      expect(list[RankTrack.ADULT][2].nextRankId).toBeNull();
      expect(list[RankTrack.ADULT][2].previousRankId).toBe(a.id);
      void m;
      void child1;
    });

    it('rejects a self-referencing previousRank', async () => {
      const group = await createGroupWithSystem();
      const rank = (await createRank(
        group.token,
        group.id,
        rankPayload(),
      )) as RankResponseDto;

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/ranks/${rank.id}`)
          .set('Authorization', `Bearer ${group.token}`)
          .send(rankPayload({ previousRankId: rank.id }))
          .expect(409),
      );
      expect(error.statusCode).toBe(409);
    });

    it('rejects a cycle (a -> b -> a)', async () => {
      const group = await createGroupWithSystem();
      const a = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'A' }),
      )) as RankResponseDto;
      const b = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'B', previousRankId: a.id }),
      )) as RankResponseDto;

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/ranks/${a.id}`)
          .set('Authorization', `Bearer ${group.token}`)
          .send(rankPayload({ name: 'A', previousRankId: b.id }))
          .expect(409),
      );
      expect(error.statusCode).toBe(409);
    });

    it('rejects branching - a second rank cannot point at an already-claimed previousRank', async () => {
      const group = await createGroupWithSystem();
      const a = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'A' }),
      )) as RankResponseDto;
      await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'B', previousRankId: a.id }),
      );

      const error = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'C', previousRankId: a.id }),
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('rejects a second first-rank (previousRankId null) for the same system+track', async () => {
      const group = await createGroupWithSystem();
      await createRank(group.token, group.id, rankPayload({ name: 'First' }));

      const error = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'Also first' }),
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('rejects a previousRank belonging to a different graduation system', async () => {
      const groupA = await createGroupWithSystem();
      const groupB = await createGroupWithSystem();
      const rankInB = (await createRank(
        groupB.token,
        groupB.id,
        rankPayload(),
      )) as RankResponseDto;

      const error = (await createRank(
        groupA.token,
        groupA.id,
        rankPayload({ previousRankId: rankInB.id }),
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('rejects a previousRank belonging to a different track in the same system', async () => {
      const group = await createGroupWithSystem();
      const childRank = (await createRank(
        group.token,
        group.id,
        rankPayload({ track: RankTrack.CHILD }),
      )) as RankResponseDto;

      const error = (await createRank(
        group.token,
        group.id,
        rankPayload({ track: RankTrack.ADULT, previousRankId: childRank.id }),
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });
  });

  // ─── Cord segments ───────────────────────────────────────────────────────

  describe('Ranks - cord segments', () => {
    it('accepts one color, two colors, and many colors summing to 100', async () => {
      const group = await createGroupWithSystem();

      const one = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'One color', cordSegments: oneSegment() }),
      )) as RankResponseDto;
      expect(one.cordSegments).toHaveLength(1);

      const two = (await createRank(
        group.token,
        group.id,
        rankPayload({
          name: 'Two colors',
          previousRankId: one.id,
          cordSegments: [
            { position: 1, colorHex: '#000000', proportion: 50 },
            { position: 2, colorHex: '#FFFFFF', proportion: 50 },
          ],
        }),
      )) as RankResponseDto;
      expect(two.cordSegments.map((s) => s.colorHex)).toEqual([
        '#000000',
        '#FFFFFF',
      ]);

      const many = (await createRank(
        group.token,
        group.id,
        rankPayload({
          name: 'Matching tips',
          previousRankId: two.id,
          cordSegments: [
            { position: 1, colorHex: '#00FF00', proportion: 25 },
            { position: 2, colorHex: '#0000FF', proportion: 50 },
            { position: 3, colorHex: '#00FF00', proportion: 25 },
          ],
        }),
      )) as RankResponseDto;
      expect(many.cordSegments).toHaveLength(3);
      expect(many.cordSegments[0].colorHex).toBe(many.cordSegments[2].colorHex);
    });

    it('rejects a proportion sum different from 100', async () => {
      const group = await createGroupWithSystem();
      const error = (await createRank(
        group.token,
        group.id,
        rankPayload({
          cordSegments: [
            { position: 1, colorHex: '#FF0000', proportion: 40 },
            { position: 2, colorHex: '#00FF00', proportion: 40 },
          ],
        }),
        400,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(400);
    });

    it('rejects a malformed hex color', async () => {
      const group = await createGroupWithSystem();
      const error = (await createRank(
        group.token,
        group.id,
        rankPayload({ cordSegments: oneSegment({ colorHex: 'not-a-color' }) }),
        400,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(400);
    });

    it('replaces segments atomically on update (old set fully gone, new set fully present)', async () => {
      const group = await createGroupWithSystem();
      const rank = (await createRank(
        group.token,
        group.id,
        rankPayload({
          cordSegments: [
            { position: 1, colorHex: '#111111', proportion: 50 },
            { position: 2, colorHex: '#222222', proportion: 50 },
          ],
        }),
      )) as RankResponseDto;

      const updated = await bodyOf<RankResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${group.id}/ranks/${rank.id}`)
          .set('Authorization', `Bearer ${group.token}`)
          .send(
            rankPayload({ cordSegments: oneSegment({ colorHex: '#ABCDEF' }) }),
          )
          .expect(200),
      );

      expect(updated.cordSegments).toHaveLength(1);
      expect(updated.cordSegments[0].colorHex).toBe('#ABCDEF');
    });
  });

  // ─── Archive / restore ───────────────────────────────────────────────────

  describe('Ranks - archive/restore', () => {
    it('archives and restores a rank, and blocks archiving twice', async () => {
      const group = await createGroupWithSystem();
      const rank = (await createRank(
        group.token,
        group.id,
        rankPayload(),
      )) as RankResponseDto;

      const archived = await bodyOf<RankResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/ranks/${rank.id}/archive`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(201),
      );
      expect(archived.isArchived).toBe(true);

      const doubleArchive = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/ranks/${rank.id}/archive`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(409),
      );
      expect(doubleArchive.statusCode).toBe(409);

      const restored = await bodyOf<RankResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/ranks/${rank.id}/restore`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(201),
      );
      expect(restored.isArchived).toBe(false);
    });

    it('keeps an archived rank visible in the catalog list, correctly ordered', async () => {
      const group = await createGroupWithSystem();
      const a = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'A' }),
      )) as RankResponseDto;
      const b = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'B', previousRankId: a.id }),
      )) as RankResponseDto;
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks/${a.id}/archive`)
        .set('Authorization', `Bearer ${group.token}`)
        .expect(201);

      const list = await bodyOf<RanksByTrackResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/ranks`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(200),
      );
      expect(list[RankTrack.ADULT].map((r) => r.name)).toEqual(['A', 'B']);
      expect(list[RankTrack.ADULT][0].isArchived).toBe(true);
      void b;
    });
  });

  // ─── Public read (Group profile) ─────────────────────────────────────────

  describe('Public catalog read', () => {
    function getPublic(token: string, groupId: string, expectStatus = 200) {
      return request(app.getHttpServer())
        .get(`/api/v1/groups/${groupId}/graduation-system/public`)
        .set('Authorization', `Bearer ${token}`)
        .expect(expectStatus);
    }

    it('lets an outsider read a public Group catalog - active ranks only, in gradation order, presentation fields only', async () => {
      const group = await createGroupWithSystem();
      const first = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'Z first', description: 'Opis' }),
      )) as RankResponseDto;
      const archived = (await createRank(
        group.token,
        group.id,
        rankPayload({ name: 'A archived', previousRankId: first.id }),
      )) as RankResponseDto;
      await createRank(
        group.token,
        group.id,
        rankPayload({
          name: 'M third',
          previousRankId: archived.id,
          cordSegments: [
            { position: 1, colorHex: '#00FF00', proportion: 30 },
            { position: 2, colorHex: '#0000FF', proportion: 70 },
          ],
        }),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks/${archived.id}/archive`)
        .set('Authorization', `Bearer ${group.token}`)
        .expect(201);

      const body = await bodyOf<PublicGraduationSystemResponseDto>(
        getPublic(OUTSIDER_TOKEN, group.id),
      );

      expect(body[RankTrack.ADULT].map((r) => r.name)).toEqual([
        'Z first',
        'M third',
      ]);
      expect(body[RankTrack.CHILD]).toEqual([]);
      expect(Object.keys(body[RankTrack.ADULT][0]).sort()).toEqual([
        'cordSegments',
        'description',
        'id',
        'name',
      ]);
      expect(body[RankTrack.ADULT][0].description).toBe('Opis');
      expect(body[RankTrack.ADULT][1].cordSegments).toEqual([
        { position: 1, colorHex: '#00FF00', proportion: 30 },
        { position: 2, colorHex: '#0000FF', proportion: 70 },
      ]);
    });

    it('returns two empty tracks (never 404) for a Group without a system', async () => {
      const group = await createFreshGroup({ name: 'Public No System Group' });
      const body = await bodyOf<PublicGraduationSystemResponseDto>(
        getPublic(OUTSIDER_TOKEN, group.id),
      );
      expect(body).toEqual({ [RankTrack.CHILD]: [], [RankTrack.ADULT]: [] });
    });

    it('404s for an outsider on a private Group - same as its profile', async () => {
      const group = await createFreshGroup({
        name: `Private Grad Group ${Date.now()}`,
        isPublic: false,
      });
      await createSystem(group.token, group.id);
      await getPublic(OUTSIDER_TOKEN, group.id, 404);
    });

    it('follows exactly the Group profile visibility on a private Group - owner, ADMIN, Section member, outsider', async () => {
      const group = await createFreshGroup({
        name: `Private Parity Group ${Date.now()}`,
        isPublic: false,
      });
      await createSystem(group.token, group.id);
      await grantGroupAdmin(group.token, group.id, ADMIN_TOKEN);
      const section = await createSection(group.token, group.id);
      await grantSectionAdmin(
        group.token,
        group.id,
        section.id,
        SECTION_ADMIN_TOKEN,
      );

      for (const token of [
        group.token,
        ADMIN_TOKEN,
        SECTION_ADMIN_TOKEN,
        OUTSIDER_TOKEN,
      ]) {
        const profile = await request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}`)
          .set('Authorization', `Bearer ${token}`);
        const graduation = await request(app.getHttpServer())
          .get(`/api/v1/groups/${group.id}/graduation-system/public`)
          .set('Authorization', `Bearer ${token}`);
        expect({ token, status: graduation.status }).toEqual({
          token,
          status: profile.status,
        });
      }

      await getPublic(group.token, group.id, 200);
      await getPublic(ADMIN_TOKEN, group.id, 200);
    });

    it('never opens the catalog mutations or the admin read to an outsider', async () => {
      const group = await createGroupWithSystem();
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${group.id}/ranks`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
      await createRank(OUTSIDER_TOKEN, group.id, rankPayload(), 404);
    });
  });
});
