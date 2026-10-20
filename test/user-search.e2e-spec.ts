/**
 * E2E tests for GET /users/search - the minimal, privacy-safe user picker
 * used to look up a Training's external trainer (see
 * UserProfileService.searchUsers / user-profile.mapper.ts's
 * toUserSearchResultDto). Covers: search by public full name, search by
 * public apelido, hidden full name/apelido never findable, exact and
 * leading-zero-preserving numericCode match, safe publicCode fallback,
 * pagination, empty results, malformed queries, and the absence of any
 * private field in the response shape.
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
import { UserResponseDto } from '../src/users/dto/user-response.dto';
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { UserSearchListResponseDto } from '../src/users/dto/user-search-result.dto';

const uniqueSuffix = `${Date.now()}`;

const TOKENS = {
  searcher: `valid-user-search-searcher-token-${uniqueSuffix}`,
  publicName: `valid-user-search-public-name-token-${uniqueSuffix}`,
  publicApelido: `valid-user-search-public-apelido-token-${uniqueSuffix}`,
  hiddenName: `valid-user-search-hidden-name-token-${uniqueSuffix}`,
  hiddenApelido: `valid-user-search-hidden-apelido-token-${uniqueSuffix}`,
  fallback: `valid-user-search-fallback-token-${uniqueSuffix}`,
  pageA: `valid-user-search-page-a-token-${uniqueSuffix}`,
  pageB: `valid-user-search-page-b-token-${uniqueSuffix}`,
  pageC: `valid-user-search-page-c-token-${uniqueSuffix}`,
} as const;

const CLERK_IDS = {
  searcher: `user_test_search_searcher_${uniqueSuffix}`,
  publicName: `user_test_search_public_name_${uniqueSuffix}`,
  publicApelido: `user_test_search_public_apelido_${uniqueSuffix}`,
  hiddenName: `user_test_search_hidden_name_${uniqueSuffix}`,
  hiddenApelido: `user_test_search_hidden_apelido_${uniqueSuffix}`,
  fallback: `user_test_search_fallback_${uniqueSuffix}`,
  pageA: `user_test_search_page_a_${uniqueSuffix}`,
  pageB: `user_test_search_page_b_${uniqueSuffix}`,
  pageC: `user_test_search_page_c_${uniqueSuffix}`,
} as const;

const TOKEN_TO_CLERK_ID: Record<string, string> = Object.fromEntries(
  Object.entries(TOKENS).map(([key, token]) => [
    token,
    CLERK_IDS[key as keyof typeof CLERK_IDS],
  ]),
);

const TOKEN_TO_AUTH: Record<string, AuthContext> = Object.fromEntries(
  Object.entries(TOKEN_TO_CLERK_ID).map(([token, clerkUserId]) => [
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

describe('User Search (e2e)', () => {
  let app: INestApplication<App>;

  const PUBLIC_FIRST = `SearchAda${uniqueSuffix}`;
  const PUBLIC_LAST = `SearchLovelace${uniqueSuffix}`;
  const PUBLIC_APELIDO = `SearchFormiga${uniqueSuffix}`;
  const HIDDEN_FIRST = `SearchHiddenAda${uniqueSuffix}`;
  const HIDDEN_LAST = `SearchHiddenLovelace${uniqueSuffix}`;
  const HIDDEN_APELIDO = `SearchHiddenFormiga${uniqueSuffix}`;
  const PAGE_APELIDO_PREFIX = `SearchPage${uniqueSuffix}`;

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

    for (const token of Object.values(TOKENS)) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    await patchProfile(TOKENS.publicName, {
      firstName: PUBLIC_FIRST,
      lastName: PUBLIC_LAST,
    });
    await patchProfile(TOKENS.publicApelido, {
      apelido: PUBLIC_APELIDO,
    });
    await patchProfile(TOKENS.hiddenName, {
      firstName: HIDDEN_FIRST,
      lastName: HIDDEN_LAST,
    });
    await patchProfile(TOKENS.hiddenApelido, {
      apelido: HIDDEN_APELIDO,
    });
    for (const [token, suffix] of [
      [TOKENS.pageA, 'A'],
      [TOKENS.pageB, 'B'],
      [TOKENS.pageC, 'C'],
    ] as const) {
      await patchProfile(token, {
        apelido: `${PAGE_APELIDO_PREFIX}${suffix}`,
      });
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function patchProfile(
    token: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);
  }

  function getMe(token: string): Promise<UserResponseDto> {
    return bodyOf<UserResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  function getMyProfile(token: string): Promise<UserProfileResponseDto> {
    return bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  function search(
    query: string,
    params: Record<string, string | number> = {},
  ): Promise<UserSearchListResponseDto> {
    return bodyOf<UserSearchListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/search')
        .query({ search: query, ...params })
        .set('Authorization', `Bearer ${TOKENS.searcher}`)
        .expect(200),
    );
  }

  it('finds a user by their public full name', async () => {
    const target = await getMe(TOKENS.publicName);
    const result = await search(PUBLIC_FIRST);

    expect(result.items.map((item) => item.id)).toContain(target.id);
    const match = result.items.find((item) => item.id === target.id);
    expect(match?.displayName).toBe(`${PUBLIC_FIRST} ${PUBLIC_LAST}`);
  });

  it('finds a user by their public apelido', async () => {
    const target = await getMe(TOKENS.publicApelido);
    const result = await search(PUBLIC_APELIDO);

    expect(result.items.map((item) => item.id)).toContain(target.id);
    const match = result.items.find((item) => item.id === target.id);
    expect(match?.displayName).toBe(PUBLIC_APELIDO);
  });

  // Identity has no privacy toggle any more - every user is findable by
  // (and labelled with) their real name/apelido.
  it('finds any user by full name and labels them with it, never with their code', async () => {
    const target = await getMe(TOKENS.hiddenName);
    const result = await search(HIDDEN_FIRST);

    const match = result.items.find((item) => item.id === target.id);
    expect(match?.displayName).toBe(`${HIDDEN_FIRST} ${HIDDEN_LAST}`);
  });

  it('finds any user by apelido', async () => {
    const target = await getMe(TOKENS.hiddenApelido);
    const result = await search(HIDDEN_APELIDO);

    const match = result.items.find((item) => item.id === target.id);
    expect(match?.displayName).toBe(HIDDEN_APELIDO);
  });

  it('rejects the removed privacy fields - PATCH never stores showFullName/showApelido', async () => {
    const profile = await bodyOf<Record<string, unknown>>(
      request(app.getHttpServer())
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${TOKENS.hiddenName}`)
        .send({ showFullName: false, showApelido: false })
        .expect(200),
    );
    expect(profile.privacy).not.toHaveProperty('showFullName');
    expect(profile.privacy).not.toHaveProperty('showApelido');

    const target = await getMe(TOKENS.hiddenName);
    const result = await search(HIDDEN_FIRST);
    expect(result.items.map((item) => item.id)).toContain(target.id);
  });

  it('falls back to publicCode as displayName only for a user with no name or apelido at all', async () => {
    const target = await getMe(TOKENS.fallback);
    expect(target.publicCode).toBeTruthy();

    const result = await search(target.publicCode as string);

    const match = result.items.find((item) => item.id === target.id);
    expect(match).toBeDefined();
    expect(match?.displayName).toBe(target.publicCode);
  });

  it('finds a user by their exact numericCode', async () => {
    const target = await getMe(TOKENS.publicName);
    const profile = await getMyProfile(TOKENS.publicName);

    const result = await search(profile.numericCode);

    expect(result.items.map((item) => item.id)).toContain(target.id);
    const match = result.items.find((item) => item.id === target.id);
    expect(match?.numericCode).toBe(profile.numericCode);
  });

  it('finds a user by the start of their code, also typed as the displayed "U123-456"', async () => {
    const target = await getMe(TOKENS.publicName);
    const profile = await getMyProfile(TOKENS.publicName);
    const code = profile.numericCode;

    for (const typed of [
      code.slice(0, 4),
      `U${code.slice(0, 3)}-${code.slice(3, 5)}`,
    ]) {
      const result = await search(typed);
      expect(result.items.map((item) => item.id)).toContain(target.id);
    }
  });

  describe('leading-zero numericCode', () => {
    it('treats "000123" and "123" as different codes (no numeric coercion)', async () => {
      const target = await getMe(TOKENS.fallback);
      const em = app.get(EntityManager).fork();
      await em.nativeUpdate(User, { id: target.id }, { numericCode: '000123' });

      const exact = await search('000123');
      expect(exact.items.map((item) => item.id)).toContain(target.id);

      const dashed = await search('000-123');
      expect(dashed.items.map((item) => item.id)).toContain(target.id);

      const stripped = await search('123');
      expect(stripped.items.map((item) => item.id)).not.toContain(target.id);
    });
  });

  describe('pagination', () => {
    it('paginates matching results using limit/offset and reports total/hasMore', async () => {
      const firstPage = await search(PAGE_APELIDO_PREFIX, {
        limit: 2,
        offset: 0,
      });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.total).toBe(3);
      expect(firstPage.hasMore).toBe(true);

      const secondPage = await search(PAGE_APELIDO_PREFIX, {
        limit: 2,
        offset: 2,
      });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.total).toBe(3);
      expect(secondPage.hasMore).toBe(false);

      const allIds = new Set([
        ...firstPage.items.map((item) => item.id),
        ...secondPage.items.map((item) => item.id),
      ]);
      expect(allIds.size).toBe(3);
    });
  });

  it('returns an empty result set (not an error) for a well-formed query with no matches', async () => {
    const result = await search(`${uniqueSuffix}nomatchatall`);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it.each(['', 'a'])(
    'returns 400 for a too-short search text %p (not an exact numeric code)',
    async (tooShort) => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/search')
          .query({ search: tooShort })
          .set('Authorization', `Bearer ${TOKENS.searcher}`)
          .expect(400),
      );
      expect(error.statusCode).toBe(400);
    },
  );

  it('returns 400 (never 500) when the search param is missing entirely', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/search')
      .set('Authorization', `Bearer ${TOKENS.searcher}`)
      .expect(400);
  });

  it('never exposes email, clerkUserId, or any other private field in the result shape', async () => {
    const result = await search(PUBLIC_FIRST);
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['apelido', 'displayName', 'id', 'image', 'numericCode'].sort(),
      );
    }
  });

  it('returns 401 for an unauthenticated search', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/search')
      .query({ search: 'anything' })
      .expect(401);
  });
});
