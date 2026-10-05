import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';

export interface FixtureClerkProfile {
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string } | null;
}

export interface CreateFreshGroupOwnerParams {
  app: INestApplication<App>;
  // The same TOKEN_TO_AUTH / FIXTURE_CLERK_PROFILES objects the file's own
  // fixtureClerkAuthService/fixtureClerkClient closures already read from at
  // call time - passed by reference and mutated in place (never
  // reassigned), so a token registered here is immediately usable through
  // the file's existing auth mocks with no other wiring.
  tokenToAuth: Record<string, AuthContext>;
  clerkProfiles: Record<string, FixtureClerkProfile>;
  // Only needed when the file's afterAll cleans up fixture Users from some
  // separately-tracked array rather than `Object.keys(clerkProfiles)`
  // (computed fresh at cleanup time) - most files use the latter, since
  // `clerkProfiles` is mutated in place here and already carries every
  // fixture user by the time afterAll runs, so no separate tracking is
  // needed for them. Provide this only if that file's cleanup still uses
  // the old frozen-snapshot pattern (a `const TEST_CLERK_USER_IDS =
  // Object.keys(FIXTURE_CLERK_PROFILES)` computed once, before any
  // fixtures are registered) and hasn't been switched over.
  onClerkUserCreated?: (clerkUserId: string) => void;
  // Same idea for the created Group's id, when the file separately deletes
  // Groups by id in afterAll (most files do - see e.g. groups.e2e-spec.ts's
  // createdGroupIds). Omit only when the file's cleanup already deletes
  // every Group by some other means (e.g. a blanket delete of everything
  // founded by a set of known users).
  onGroupCreated?: (groupId: string) => void;
  // Short, file-specific label (e.g. 'groups-list', 'hierarchy-a') folded
  // into the generated clerk id/token/email so failures are traceable back
  // to the call site that created them, same spirit as this suite's
  // existing hand-named OWNER_TOKEN/SECOND_TOKEN constants.
  namePrefix: string;
  groupOverrides?: Record<string, unknown>;
}

export interface FreshGroupOwner {
  token: string;
  clerkUserId: string;
  userId: string;
  group: GroupResponseDto;
}

/**
 * Registers a brand-new fixture user - its own Clerk id and session token,
 * entirely unrelated to any other fixture user already set up in the
 * calling file - and has them create a Group through the real
 * `POST /groups` endpoint, so they end up as its genuine OWNER with a real
 * FormalGroupAffiliation, exactly as a real user would.
 *
 * Exists because `GroupsService.create` now allows at most one *active*
 * FormalGroupAffiliation per user (see USER_ALREADY_HAS_FORMAL_GROUP): the
 * old, file-wide convention of registering one fixed OWNER_TOKEN in
 * `beforeAll` and calling a local `createGroup(OWNER_TOKEN, ...)` helper
 * from many unrelated `it()` blocks throughout the file no longer works
 * once that token's user already owns a Group - every call after the first
 * now 409s. Use this instead in any test that just needs "N independent
 * Groups" with no relationship to each other or to another fixture user
 * (list/filter/pagination/search/discovery fixtures, mostly) - each call
 * mints its own fresh owner, so there is never a second create attempt by
 * the same user. Do NOT reach for this when the test's actual premise is a
 * shared owner/actor (role grants, hierarchy between two Groups owned by
 * the same admin, repeated operations against one Group) - keep the
 * existing shared token there and read/adjust that test's setup instead.
 */
export async function createFreshGroupOwner({
  app,
  tokenToAuth,
  clerkProfiles,
  onClerkUserCreated,
  onGroupCreated,
  namePrefix,
  groupOverrides = {},
}: CreateFreshGroupOwnerParams): Promise<FreshGroupOwner> {
  const suffix = `${namePrefix}-${randomUUID().slice(0, 8)}`;
  const clerkUserId = `user_test_${suffix}`;
  const token = `valid-${suffix}-token`;

  tokenToAuth[token] = {
    userId: clerkUserId,
    sessionId: `sess_${suffix}`,
    tokenType: 'session_token',
    claims: { sub: clerkUserId, sid: `sess_${suffix}` },
  };
  clerkProfiles[clerkUserId] = {
    imageUrl: `https://img.clerk.com/${suffix}.png`,
    primaryEmailAddress: { emailAddress: `${suffix}@example.com` },
  };
  onClerkUserCreated?.(clerkUserId);

  // Same "hit an authenticated endpoint once to provision the local User
  // row, then look it up by clerkUserId" bootstrap every file's own
  // beforeAll already does for its fixed tokens.
  await request(app.getHttpServer())
    .get('/api/v1/groups')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const em = app.get(EntityManager).fork();
  const user = await em.findOneOrFail(User, { clerkUserId });

  const res = await request(app.getHttpServer())
    .post('/api/v1/groups')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: `Fresh Group ${suffix}`,
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
      ...groupOverrides,
    })
    .expect(201);

  const group = res.body as GroupResponseDto;
  onGroupCreated?.(group.id);

  return { token, clerkUserId, userId: user.id, group };
}

/**
 * Test-fixture ONLY: makes `newOwnerUserId` the OWNER of `groupId` straight
 * in the database, bypassing POST .../transfer-ownership.
 *
 * The real transfer now enforces "one owned Group / one formal Group per
 * user" (see owner-formal-group.ts), so a single actor can no longer come
 * to own several Groups through the API. A few hierarchy tests still need
 * exactly that shape - direct attach/move/detach require OWNER
 * (HIERARCHY_MANAGE) on both ends - to exercise hierarchy rules that have
 * nothing to do with ownership. This reproduces the legacy multi-owner
 * state those tests need (the same state Migration20261002160000_
 * BackfillOwnerFormalGroup deliberately leaves alone) without weakening
 * the production rule. Never use it to test ownership itself.
 */
export async function forceGroupOwnerForFixture(
  app: INestApplication<App>,
  groupId: string,
  newOwnerUserId: string,
): Promise<void> {
  const em = app.get(EntityManager).fork();
  const now = new Date();
  // Revoke first, in its own statement - ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX
  // allows exactly one active OWNER per Group.
  await em
    .getConnection()
    .execute(
      `update "role_assignments" set "revoked_at" = ? where "group_id" = ? and "role" = 'OWNER' and "revoked_at" is null`,
      [now, groupId],
    );
  await em.getConnection().execute(
    `insert into "role_assignments" ("id", "created_at", "updated_at", "user_id", "group_id", "role", "granted_at")
     values (?, ?, ?, ?, ?, 'OWNER', ?)`,
    [randomUUID(), now, now, newOwnerUserId, groupId, now],
  );
}
