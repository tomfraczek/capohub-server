/**
 * E2E tests for GET /users/me/formal-rank-options - the self-service
 * catalog read used to power PUT /users/me/formal-rank and
 * POST .../formal-rank-correction/submit, without requiring
 * GroupPermission.GRADUATION_SYSTEM_VIEW.
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
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import { RankResponseDto } from '../src/graduation/dto/rank-response.dto';
import { FormalRankOptionsResponseDto } from '../src/graduation/dto/formal-rank-options-response.dto';
import { GraduationSystem } from '../src/graduation/entities/graduation-system.entity';
import { Rank } from '../src/graduation/entities/rank.entity';
import { FormalRankAssignment } from '../src/graduation/entities/formal-rank-assignment.entity';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';

const OWNER_TOKEN = 'valid-fro-owner-token';
const MEMBER_TOKEN = 'valid-fro-member-token';
const NO_GROUP_TOKEN = 'valid-fro-no-group-token';

const TOKENS = [OWNER_TOKEN, MEMBER_TOKEN, NO_GROUP_TOKEN];

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

function oneSegment(colorHex = '#123456') {
  return [{ position: 1, colorHex, proportion: 100 }];
}

describe('Formal Rank Options (self-service) (e2e)', () => {
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
      await cleanup.nativeDelete(FormalRankAssignment, {
        user: { $in: [...localUserIdByToken.values()] },
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

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'FRO Test Group',
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

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'FRO Test Section',
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
  ): Promise<{ id: string }> {
    const created = await bodyOf<{ id: string }>(
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

  // setFormalGroup requires an active SectionMembership somewhere in the
  // Group's hierarchy (see UserProfileService.setFormalGroup) - this
  // fixture creates that qualifying Section membership for `memberToken`
  // before returning the Group ready for setFormalGroup.
  async function createGroupWithCatalog(
    memberToken: string,
  ): Promise<GroupResponseDto> {
    const group = await createGroup(OWNER_TOKEN, {
      name: `FRO Group ${Date.now()}-${Math.random()}`,
    });
    const section = await createSection(OWNER_TOKEN, group.id);
    await joinSection(OWNER_TOKEN, section.id, memberToken);
    return group;
  }

  async function createSystem(
    groupId: string,
  ): Promise<GraduationSystemResponseDto> {
    return bodyOf<GraduationSystemResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/graduation-system`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ name: 'System' })
        .expect(201),
    );
  }

  async function createRank(
    groupId: string,
    body: Record<string, unknown>,
  ): Promise<RankResponseDto> {
    return bodyOf<RankResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/ranks`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(body)
        .expect(201),
    );
  }

  async function archiveRank(groupId: string, rankId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/ranks/${rankId}/archive`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(201);
  }

  async function setFormalGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/v1/users/me/formal-group')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId })
      .expect(200);
  }

  async function getOptions(
    token: string,
  ): Promise<FormalRankOptionsResponseDto> {
    return bodyOf<FormalRankOptionsResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/formal-rank-options')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  it('returns null formalGroup/graduationSystem and empty tracks when the caller has no formal group', async () => {
    const options = await getOptions(NO_GROUP_TOKEN);

    expect(options.formalGroup).toBeNull();
    expect(options.graduationSystem).toBeNull();
    expect(options.ranks[RankTrack.CHILD]).toEqual([]);
    expect(options.ranks[RankTrack.ADULT]).toEqual([]);
  });

  it("returns the caller's formal group catalog, both CHILD and ADULT tracks, in gradation order", async () => {
    const group = await createGroupWithCatalog(MEMBER_TOKEN);
    await createSystem(group.id);
    const adultA = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Corda Crua',
      description: 'First adult rank',
      previousRankId: null,
      cordSegments: oneSegment(),
    });
    const adultB = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Corda Verde',
      description: null,
      previousRankId: adultA.id,
      cordSegments: oneSegment('#00FF00'),
    });
    const adultC = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Corda Azul',
      description: null,
      previousRankId: adultB.id,
      cordSegments: oneSegment('#0000FF'),
    });
    const childA = await createRank(group.id, {
      track: RankTrack.CHILD,
      name: 'Corda Infantil 1',
      description: null,
      previousRankId: null,
      cordSegments: oneSegment('#FFFFFF'),
    });

    await setFormalGroup(MEMBER_TOKEN, group.id);
    const options = await getOptions(MEMBER_TOKEN);

    expect(options.formalGroup).toEqual({ id: group.id, name: group.name });
    expect(options.graduationSystem?.name).toBe('System');
    expect(options.ranks[RankTrack.ADULT].map((r) => r.id)).toEqual([
      adultA.id,
      adultB.id,
      adultC.id,
    ]);
    expect(options.ranks[RankTrack.CHILD].map((r) => r.id)).toEqual([
      childA.id,
    ]);

    const returnedAdultA = options.ranks[RankTrack.ADULT][0];
    expect(returnedAdultA).toMatchObject({
      id: adultA.id,
      name: 'Corda Crua',
      description: 'First adult rank',
      track: RankTrack.ADULT,
      previousRankId: null,
      nextRankId: adultB.id,
    });
    expect(returnedAdultA.cordSegments).toEqual([
      { position: 1, colorHex: '#123456', proportion: 100 },
    ]);
    expect(returnedAdultA).not.toHaveProperty('isArchived');
    expect(returnedAdultA).not.toHaveProperty('createdAt');
  });

  it('excludes an archived Rank from the options, without breaking the order of the ones around it', async () => {
    const group = await createGroupWithCatalog(MEMBER_TOKEN);
    await createSystem(group.id);
    const rankA = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Rank A',
      description: null,
      previousRankId: null,
      cordSegments: oneSegment(),
    });
    const rankB = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Rank B (will be archived)',
      description: null,
      previousRankId: rankA.id,
      cordSegments: oneSegment('#00FF00'),
    });
    const rankC = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Rank C',
      description: null,
      previousRankId: rankB.id,
      cordSegments: oneSegment('#0000FF'),
    });
    await archiveRank(group.id, rankB.id);

    await setFormalGroup(MEMBER_TOKEN, group.id);
    const options = await getOptions(MEMBER_TOKEN);

    const ids = options.ranks[RankTrack.ADULT].map((r) => r.id);
    expect(ids).toContain(rankA.id);
    expect(ids).toContain(rankC.id);
    expect(ids).not.toContain(rankB.id);
  });

  it('never leaks another Group catalog - options always reflect only the current formal group', async () => {
    const groupA = await createGroupWithCatalog(MEMBER_TOKEN);
    await createSystem(groupA.id);
    const rankGroupA = await createRank(groupA.id, {
      track: RankTrack.ADULT,
      name: 'Group A Only Rank',
      description: null,
      previousRankId: null,
      cordSegments: oneSegment(),
    });

    const groupB = await createGroupWithCatalog(MEMBER_TOKEN);
    await createSystem(groupB.id);
    const rankGroupB = await createRank(groupB.id, {
      track: RankTrack.ADULT,
      name: 'Group B Only Rank',
      description: null,
      previousRankId: null,
      cordSegments: oneSegment('#00FF00'),
    });

    await setFormalGroup(MEMBER_TOKEN, groupA.id);
    const optionsForA = await getOptions(MEMBER_TOKEN);
    const idsForA = optionsForA.ranks[RankTrack.ADULT].map((r) => r.id);
    expect(idsForA).toContain(rankGroupA.id);
    expect(idsForA).not.toContain(rankGroupB.id);

    // Changing the formal group flips the options to the new group's
    // catalog entirely.
    await setFormalGroup(MEMBER_TOKEN, groupB.id);
    const optionsForB = await getOptions(MEMBER_TOKEN);
    const idsForB = optionsForB.ranks[RankTrack.ADULT].map((r) => r.id);
    expect(optionsForB.formalGroup).toEqual({
      id: groupB.id,
      name: groupB.name,
    });
    expect(idsForB).toContain(rankGroupB.id);
    expect(idsForB).not.toContain(rankGroupA.id);
  });

  it('the options returned are exactly what PUT /users/me/formal-rank accepts', async () => {
    const group = await createGroupWithCatalog(MEMBER_TOKEN);
    await createSystem(group.id);
    const rank = await createRank(group.id, {
      track: RankTrack.ADULT,
      name: 'Acceptable Rank',
      description: null,
      previousRankId: null,
      cordSegments: oneSegment(),
    });

    await setFormalGroup(MEMBER_TOKEN, group.id);
    const options = await getOptions(MEMBER_TOKEN);
    const chosen = options.ranks[RankTrack.ADULT][0];
    expect(chosen.id).toBe(rank.id);

    await request(app.getHttpServer())
      .put('/api/v1/users/me/formal-rank')
      .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
      .send({ rankId: chosen.id })
      .expect(200);
  });

  it('returns 401 for an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/me/formal-rank-options')
      .expect(401);
  });
});
