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
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { CommunitySearchResultDto } from '../src/discovery/dto/community-search-result.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
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
    const cleanup = app.get(EntityManager).fork();
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
    await cleanup.nativeDelete(User, { clerkUserId: OWNER_CLERK_ID });
    await app.close();
  });

  function groupPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: `${uniqueSuffix} Group`,
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
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
      country: 'PL',
    });
    await createSection(group.id);

    const res = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent('findbyname')}`).expect(200),
    );

    const match = res.data.find((row) => row.id === group.id);
    expect(match).toBeDefined();
    expect(match?.type).toBe('GROUP');
    expect(match?.country).toBe('PL');
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

  it('filters by country', async () => {
    const group = await createGroup({
      name: `${uniqueSuffix} CountryFilter`,
      country: 'DE',
    });

    const matching = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent(uniqueSuffix)}&country=DE`).expect(200),
    );
    expect(matching.data.some((row) => row.id === group.id)).toBe(true);

    const nonMatching = await bodyOf<
      PaginatedResponse<CommunitySearchResultDto>
    >(
      search(`name=${encodeURIComponent(uniqueSuffix)}&country=FR`).expect(200),
    );
    expect(nonMatching.data.some((row) => row.id === group.id)).toBe(false);
  });

  it('filters by city (partial, case-insensitive)', async () => {
    const group = await createGroup({
      name: `${uniqueSuffix} CityFilter`,
      country: 'PL',
      city: 'Warszawa',
    });

    const res = await bodyOf<PaginatedResponse<CommunitySearchResultDto>>(
      search(`name=${encodeURIComponent(uniqueSuffix)}&city=warsz`).expect(200),
    );
    expect(res.data.some((row) => row.id === group.id)).toBe(true);
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
});
