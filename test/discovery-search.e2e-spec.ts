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
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { CityResultDto } from '../src/discovery/dto/city-result.dto';
import { CommunitySearchResultDto } from '../src/discovery/dto/community-search-result.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';

const OWNER_TOKEN = 'valid-discovery-owner-token';
const OWNER_CLERK_ID = 'user_test_discovery_owner';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_discovery_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_discovery_owner' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/discovery-owner.png',
    primaryEmailAddress: { emailAddress: 'discovery.owner@example.com' },
  },
};

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

describe('Discovery search (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const uniqueSuffix = `disc${Date.now()}`;

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

    // Bootstrap the local User row for OWNER_TOKEN.
    await request(app.getHttpServer())
      .get('/api/v1/groups')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(200);
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      // Sections must be removed before their parent Groups to satisfy the
      // parent_group_id foreign key (no cascade - see section.entity.ts).
      await cleanup.nativeDelete(Section, { id: { $in: createdGroupIds } });
      // Child Groups must be nulled before their parents to satisfy the
      // parent_group_id self-FK (no cascade - see group.entity.ts).
      await cleanup.nativeUpdate(
        Group,
        { id: { $in: createdGroupIds } },
        { parentGroup: null },
      );
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      await cleanup.nativeDelete(User, { clerkUserId: OWNER_CLERK_ID });
    });
  });

  function groupPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: `${uniqueSuffix} Group`,
      isPublic: true,
      isHidden: false,
      ...overrides,
    };
  }

  function sectionPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: `${uniqueSuffix} Section`,
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
      isPublic: true,
      isHidden: false,
      country: 'BR',
      city: 'São Paulo',
      region: 'São Paulo',
      geonameId: 3448439,
      ...overrides,
    };
  }

  async function createGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(groupPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function createSection(
    groupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/sections`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  function search(qs: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/discovery/search?${qs}`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`);
  }

  it('rejects a request with no name/country/city (type alone is not enough)', async () => {
    const res = await search('type=GROUP').expect(400);
    expect((res.body as HttpErrorResponse).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request with absolutely no query params', async () => {
    const res = await search('').expect(400);
    expect((res.body as HttpErrorResponse).code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid country code', async () => {
    await search('country=XX').expect(400);
    await search('country=poland').expect(400);
  });

  it('finds a Group by partial, case-insensitive name and reports type/sectionsCount', async () => {
    const group = await createGroup({
      name: `${uniqueSuffix} FindByName`,
    });
    await createSection(group.id);

    const res = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent('findbyname')}`).expect(200),
    );

    const match = res.data.find((row) => row.id === group.id);
    expect(match).toBeDefined();
    expect(match?.type).toBe('GROUP');
    // Group has no location fields (stage-1 organizational-domain rebuild).
    expect(match?.country).toBeNull();
    expect(match?.parentId).toBeNull();
    expect(match?.sectionsCount).toBe(1);
  });

  it('finds a Section by name and reports its parentId, not sectionsCount', async () => {
    const group = await createGroup({
      name: `${uniqueSuffix} ParentForSection`,
    });
    const section = await createSection(group.id, {
      name: `${uniqueSuffix} FindableSection`,
    });

    const res = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent('findablesection')}`).expect(200),
    );

    const match = res.data.find((row) => row.id === section.id);
    expect(match).toBeDefined();
    expect(match?.type).toBe('SECTION');
    expect(match?.parentId).toBe(group.id);
    expect(match?.sectionsCount).toBeNull();
    expect(match?.country).toBe('BR');
  });

  it('filters by country - Group has no location, so only a Section can match', async () => {
    const root = await createGroup({
      name: `${uniqueSuffix} CountryFilter Root`,
    });
    const section = await createSection(root.id, {
      name: `${uniqueSuffix} CountryFilter`,
      country: 'DE',
      city: 'Berlin',
      region: 'State of Berlin',
      geonameId: 2950159,
    });

    const matching = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent(uniqueSuffix)}&country=DE`).expect(200),
    );
    expect(matching.data.some((row) => row.id === section.id)).toBe(true);

    const nonMatching = await bodyOf<
      PaginatedResponse<CommunitySearchResultDto>
    >(
      search(`name=${encodeURIComponent(uniqueSuffix)}&country=FR`).expect(200),
    );
    expect(nonMatching.data.some((row) => row.id === section.id)).toBe(false);
  });

  it('filters by city (partial, case-insensitive) - Group has no location, so only a Section can match', async () => {
    const root = await createGroup({ name: `${uniqueSuffix} CityFilter Root` });
    const section = await createSection(root.id, {
      name: `${uniqueSuffix} CityFilter`,
      country: 'PL',
      city: 'Warsaw',
      region: 'Mazovia',
      geonameId: 756135,
    });

    const res = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent(uniqueSuffix)}&city=wars`).expect(200),
    );
    expect(res.data.some((row) => row.id === section.id)).toBe(true);
  });

  it('filters by type to build separate Groups/Sections tabs', async () => {
    const group = await createGroup({
      name: `${uniqueSuffix} TypeFilterParent`,
    });
    const section = await createSection(group.id, {
      name: `${uniqueSuffix} TypeFilterChild`,
    });

    const groupsOnly = await bodyOf<
      PaginatedResponse<CommunitySearchResultDto>
    >(
      search(`name=${encodeURIComponent(uniqueSuffix)}&type=GROUP`).expect(200),
    );
    expect(groupsOnly.data.every((row) => row.type === 'GROUP')).toBe(true);
    expect(groupsOnly.data.some((row) => row.id === group.id)).toBe(true);
    expect(groupsOnly.data.some((row) => row.id === section.id)).toBe(false);

    const sectionsOnly = await bodyOf<
      PaginatedResponse<CommunitySearchResultDto>
    >(
      search(`name=${encodeURIComponent(uniqueSuffix)}&type=SECTION`).expect(
        200,
      ),
    );
    expect(sectionsOnly.data.every((row) => row.type === 'SECTION')).toBe(true);
    expect(sectionsOnly.data.some((row) => row.id === section.id)).toBe(true);
    expect(sectionsOnly.data.some((row) => row.id === group.id)).toBe(false);
  });

  it('never returns a hidden Group/Section', async () => {
    const hidden = await createGroup({
      name: `${uniqueSuffix} HiddenGroup`,
      isHidden: true,
    });

    const res = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent(uniqueSuffix)}`).expect(200),
    );
    expect(res.data.some((row) => row.id === hidden.id)).toBe(false);
  });

  it('paginates results and returns correct meta', async () => {
    const prefix = `${uniqueSuffix}Page`;
    for (let i = 0; i < 3; i += 1) {
      await createGroup({ name: `${prefix} ${i}` });
    }

    const page1 = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent(prefix)}&page=1&limit=2`).expect(200),
    );
    expect(page1.data.length).toBe(2);
    expect(page1.meta.totalItems).toBe(3);
    expect(page1.meta.totalPages).toBe(2);
    expect(page1.meta.hasNextPage).toBe(true);
    expect(page1.meta.hasPreviousPage).toBe(false);

    const page2 = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent(prefix)}&page=2&limit=2`).expect(200),
    );
    expect(page2.data.length).toBe(1);
    expect(page2.meta.hasNextPage).toBe(false);
    expect(page2.meta.hasPreviousPage).toBe(true);
  });

  describe('GET /discovery/cities', () => {
    function searchCities(qs: string) {
      return request(app.getHttpServer())
        .get(`/api/v1/discovery/cities?${qs}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`);
    }

    it('returns only cities of the requested country', async () => {
      const res = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=krak').expect(200),
      );

      expect(res.length).toBeGreaterThan(0);
      expect(res.every((city) => city.country === 'PL')).toBe(true);
      expect(res.some((city) => city.name === 'Kraków')).toBe(true);
    });

    it('narrows by a case-insensitive substring match on name', async () => {
      const res = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=pozna').expect(200),
      );

      expect(res.some((city) => city.name === 'Poznań')).toBe(true);
      expect(
        res.every((city) => city.name.toLowerCase().includes('pozna')),
      ).toBe(true);
    });

    it('caps results at the requested limit', async () => {
      const res = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&limit=3').expect(200),
      );

      expect(res.length).toBeLessThanOrEqual(3);
    });

    it('rejects a missing country', async () => {
      const res = await bodyOf<HttpErrorResponse>(
        searchCities('search=Pozn').expect(400),
      );
      expect(res.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid country code', async () => {
      await searchCities('country=XX').expect(400);
    });

    it('rejects a limit above the maximum', async () => {
      await searchCities('country=PL&limit=1000').expect(400);
    });

    it('never returns a duplicate geonameId', async () => {
      const res = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&limit=50').expect(200),
      );
      const ids = res.map((city) => city.geonameId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/discovery/cities?country=PL')
        .expect(401);
    });

    it('distinguishes two different cities that share a name via their own geonameId and region', async () => {
      const res = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=Piaski&limit=50').expect(200),
      );
      const piaskiEntries = res.filter((city) => city.name === 'Piaski');

      expect(piaskiEntries).toHaveLength(2);
      expect(new Set(piaskiEntries.map((city) => city.geonameId)).size).toBe(2);
      expect(piaskiEntries.every((city) => city.region !== null)).toBe(true);
      expect(new Set(piaskiEntries.map((city) => city.region)).size).toBe(2);
    });

    it('always includes region when resolvable, regardless of search text or limit', async () => {
      const narrow = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=Poznań&limit=50').expect(200),
      );
      expect(narrow).toEqual([
        {
          geonameId: 3088171,
          name: 'Poznań',
          country: 'PL',
          region: 'Greater Poland',
        },
      ]);

      const withoutSearch = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=pozna').expect(200),
      );
      const poznanEntry = withoutSearch.find(
        (city) => city.geonameId === 3088171,
      );
      expect(poznanEntry?.region).toBe('Greater Poland');
    });

    // The bundled GeoNames dataset lists "Warszawa" among the alternate
    // names for geonameId 756135 (Poland's capital, displayed as "Warsaw")
    // - searching either term must resolve to that exact same record (see
    // city-directory.ts / city-search.service.ts).
    it('finds the same record via the local name "Warszawa" as via the English exonym "Warsaw"', async () => {
      const byExonym = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=Warsaw').expect(200),
      );
      const byLocalName = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=Warszawa').expect(200),
      );

      expect(byExonym).toHaveLength(1);
      expect(byLocalName).toHaveLength(1);
      expect(byExonym[0]).toEqual(byLocalName[0]);
      expect(byExonym[0]).toMatchObject({ geonameId: 756135, name: 'Warsaw' });
    });

    // Group has no location fields (stage-1 organizational-domain rebuild) -
    // the geonameId/name/region contract is now Section-only, so this
    // creates a root Group first and asserts on a Section under it.
    it('returns a geonameId/name/region that Section creation accepts as-is (endpoint and validation share one source)', async () => {
      const res = await bodyOf<CityResultDto[]>(
        searchCities('country=BR&search=Paulo').expect(200),
      );
      const saoPaulo = res.find((city) => city.geonameId === 3448439);
      expect(saoPaulo).toBeDefined();

      const root = await createGroup({
        name: `${uniqueSuffix} CityContractMatch Root`,
      });
      const created = await createSection(root.id, {
        name: `${uniqueSuffix} CityContractMatch`,
        country: 'BR',
        city: saoPaulo!.name,
        region: saoPaulo!.region,
        geonameId: saoPaulo!.geonameId,
      });
      expect(created.geonameId).toBe(3448439);
    });

    // Regression coverage for the city-identification problem: the two
    // "Piaski" entries the search endpoint returns must each be usable
    // as-is (name + region + geonameId) to create a Section unambiguously -
    // proving the endpoint and the create validation agree on exactly
    // which (geonameId, name, region) combinations are real.
    it('lets each of two same-named cities be created unambiguously using the exact record the endpoint returned', async () => {
      const res = await bodyOf<CityResultDto[]>(
        searchCities('country=PL&search=Piaski&limit=50').expect(200),
      );
      const piaskiEntries = res.filter((city) => city.name === 'Piaski');
      expect(piaskiEntries).toHaveLength(2);

      const [first, second] = piaskiEntries;
      const root = await createGroup({ name: `${uniqueSuffix} Piaski Root` });
      const createdFirst = await createSection(root.id, {
        name: `${uniqueSuffix} Piaski First`,
        country: 'PL',
        city: first.name,
        region: first.region,
        geonameId: first.geonameId,
      });
      const createdSecond = await createSection(root.id, {
        name: `${uniqueSuffix} Piaski Second`,
        country: 'PL',
        city: second.name,
        region: second.region,
        geonameId: second.geonameId,
      });

      expect(createdFirst.geonameId).toBe(first.geonameId);
      expect(createdSecond.geonameId).toBe(second.geonameId);
      expect(createdFirst.geonameId).not.toBe(createdSecond.geonameId);
    });
  });
});
