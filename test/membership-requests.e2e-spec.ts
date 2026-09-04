/**
 * E2E tests for membership requests and discovery endpoints.
 *
 * Under the Membership/RoleAssignments rebuild, a Group has no membership
 * at all - join/invite/join-request only ever operate on a Section (see
 * MembershipRequestsService.join/createInvitation, both of which reject a
 * GROUP target outright with GROUP_HAS_NO_MEMBERSHIP). Every scenario below
 * that used to join/invite directly on a Group now creates a Section under
 * it first and targets that Section instead.
 *
 * Scenarios:
 *  1. POST /sections/:id/join without targetType → 400
 *  2. POST /sections/:id/join with an invalid targetType → 400
 *  3. POST /groups/:id/join with targetType=GROUP → 422 GROUP_HAS_NO_MEMBERSHIP
 *  4. POST /sections/:id/join for a public Section (isPublic=true) → auto-join
 *  5. POST /sections/:id/join for a private Section (isPublic=false) → JOIN_REQUEST
 *  6. POST /sections/:id/join for a hidden+private Section → JOIN_REQUEST (hidden does not block)
 *  7. GET  /discovery/resolve/:code for a Group → resourceType = GROUP
 *  8. GET  /discovery/resolve/:code for a hidden Group → returned (hidden bypass)
 *  9. GET  /discovery/search → hidden groups excluded from results
 * 10. POST /sections/:id/invitations/:id/cancel — inviter can cancel
 * 11. POST /sections/:id/invitations/:id/cancel — OWNER can cancel
 * 12. POST /sections/:id/invitations/:id/cancel — plain MEMBER cannot cancel someone else's
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
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { MembershipRequest } from '../src/groups/entities/membership-request.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { User } from '../src/users/entities/user.entity';

// ─── Tokens / Clerk fixtures ──────────────────────────────────────────────────

const OWNER_TOKEN = 'valid-mr-owner-token';
const MEMBER_TOKEN = 'valid-mr-member-token';
const OUTSIDER_TOKEN = 'valid-mr-outsider-token';
const SECOND_OUTSIDER_TOKEN = 'valid-mr-second-outsider-token';

const OWNER_CLERK_ID = 'user_test_mr_owner';
const MEMBER_CLERK_ID = 'user_test_mr_member';
const OUTSIDER_CLERK_ID = 'user_test_mr_outsider';
const SECOND_OUTSIDER_CLERK_ID = 'user_test_mr_second_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_mr_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_mr_owner' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_mr_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_mr_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_mr_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_mr_outsider' },
  },
  [SECOND_OUTSIDER_TOKEN]: {
    userId: SECOND_OUTSIDER_CLERK_ID,
    sessionId: 'sess_mr_second_outsider',
    tokenType: 'session_token',
    claims: { sub: SECOND_OUTSIDER_CLERK_ID, sid: 'sess_mr_second_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/mr-owner.png',
    primaryEmailAddress: { emailAddress: 'mr.owner@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/mr-member.png',
    primaryEmailAddress: { emailAddress: 'mr.member@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/mr-outsider.png',
    primaryEmailAddress: { emailAddress: 'mr.outsider@example.com' },
  },
  [SECOND_OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/mr-second-outsider.png',
    primaryEmailAddress: { emailAddress: 'mr.second.outsider@example.com' },
  },
};

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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('MembershipRequests + Discovery (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const createdSectionIds: string[] = [];

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

    // Ensure all test users exist in the local DB
    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      const allTargetIds = [...createdGroupIds, ...createdSectionIds];
      if (allTargetIds.length > 0) {
        await cleanup.nativeDelete(MembershipRequest, {
          $or: [
            { targetGroup: { $in: allTargetIds } },
            { targetSection: { $in: allTargetIds } },
          ],
        });
        await cleanup.nativeDelete(RoleAssignment, {
          $or: [
            { group: { $in: allTargetIds } },
            { section: { $in: allTargetIds } },
          ],
        });
        await cleanup.nativeDelete(SectionMembership, {
          section: { $in: createdSectionIds },
        });
        await cleanup.nativeDelete(AuditLogEntry, {
          $or: [
            { group: { $in: allTargetIds } },
            { section: { $in: allTargetIds } },
          ],
        });
        await cleanup.nativeDelete(Section, { id: { $in: createdSectionIds } });
        await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      }
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Capoeira MR Test Group',
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
  ): Promise<{ id: string; publicCode: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${token}`)
      .send(groupPayload(overrides))
      .expect(201);
    const group = res.body as { id: string; publicCode: string };
    createdGroupIds.push(group.id);
    return group;
  }

  async function createSection(
    token: string,
    parentId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; publicCode: string }> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/groups/${parentId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Capoeira MR Test Section',
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
      })
      .expect(201);
    const section = res.body as { id: string; publicCode: string };
    createdSectionIds.push(section.id);
    return section;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. POST /sections/:id/join — targetType is required; GROUP has no
  //    membership at all.
  // ──────────────────────────────────────────────────────────────────────────

  describe('POST /sections/:id/join', () => {
    it('returns 400 when targetType is missing', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({})
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
      });
    });

    it('returns 400 when targetType is an invalid value', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ targetType: 'INVALID_TYPE' });

      console.error(
        'DIAG invalid-targetType',
        'group.id=',
        group.id,
        'section.id=',
        section.id,
        'status=',
        res.status,
        'body=',
        JSON.stringify(res.body),
      );
      expect(res.status).toBe(400);
    });

    it('rejects targetType=GROUP with GROUP_HAS_NO_MEMBERSHIP - a Group has no join flow at all', async () => {
      const group = await createGroup(OWNER_TOKEN);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/join`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ targetType: 'GROUP' })
        .expect(422);

      expect(res.body).toMatchObject({ code: 'GROUP_HAS_NO_MEMBERSHIP' });
    });

    it('auto-joins a public Section and returns 200 with { joined: true }', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        isPublic: true,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      expect(res.body).toMatchObject({ joined: true });
    });

    it('creates a PENDING JOIN_REQUEST for a private (isPublic=false) Section', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        isPublic: false,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${SECOND_OUTSIDER_TOKEN}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      expect(res.body).toMatchObject({
        type: 'JOIN_REQUEST',
        status: 'PENDING',
      });
    });

    it('creates a JOIN_REQUEST for a hidden+private Section (isHidden does not block join)', async () => {
      // isHidden=true means "not in search results", not "unjoinable via direct link"
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        isPublic: false,
        isHidden: true,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      expect(res.body).toMatchObject({
        type: 'JOIN_REQUEST',
        status: 'PENDING',
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. GET /discovery/resolve/:code — Group vs hidden bypass
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /discovery/resolve/:code', () => {
    it('resolves a Group as resourceType=GROUP with isRootGroup=true', async () => {
      const group = await createGroup(OWNER_TOKEN);
      // A Group with no parent is always root-level.

      const res = await request(app.getHttpServer())
        .get(`/api/v1/discovery/resolve/${group.publicCode}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(200);

      expect(res.body).toMatchObject({
        resourceType: 'GROUP',
        group: {
          id: group.id,
          publicCode: group.publicCode,
          isRootGroup: true,
        },
        user: null,
      });
    });

    it('resolves a hidden Group (isHidden=true) via publicCode — hidden bypass works', async () => {
      const hidden = await createGroup(OWNER_TOKEN, { isHidden: true });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/discovery/resolve/${hidden.publicCode}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(200);

      const body = res.body as { group: { id: string; isHidden: boolean } };
      expect(body.group.id).toBe(hidden.id);
      expect(body.group.isHidden).toBe(true);
    });

    it('returns 404 for an unknown publicCode', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/discovery/resolve/XXXX-XXXX')
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('resolves code case-insensitively', async () => {
      const group = await createGroup(OWNER_TOKEN);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/discovery/resolve/${group.publicCode.toLowerCase()}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(200);

      const body = res.body as { group: { id: string } };
      expect(body.group.id).toBe(group.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. GET /discovery/search — hidden groups excluded
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /discovery/search', () => {
    it('does not include hidden (isHidden=true) groups in search results', async () => {
      const visible = await createGroup(OWNER_TOKEN, {
        name: 'MR Visible Group',
        isHidden: false,
      });
      const hidden = await createGroup(OWNER_TOKEN, {
        name: 'MR Hidden Group',
        isHidden: true,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/discovery/search?name=MR')
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(200);

      const searchBody = res.body as { data: Array<{ id: string }> };
      const ids = searchBody.data.map((r) => r.id);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(hidden.id);
    });

    it('returns type=GROUP for a Group in search results', async () => {
      const rootGroup = await createGroup(OWNER_TOKEN, {
        name: 'MR Root Discovery Group',
        isHidden: false,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/discovery/search?name=MR Root Discovery Group')
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(200);

      const searchBody = res.body as {
        data: Array<{ type: string; id: string }>;
      };
      const result = searchBody.data.find((r) => r.id === rootGroup.id);
      expect(result?.type).toBe('GROUP');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Cancel invitation — authorization rules (Section-scoped, Group has no
  //    invitation flow at all).
  // ──────────────────────────────────────────────────────────────────────────

  describe('POST /sections/:id/invitations/:invId/cancel — authorization', () => {
    async function setupSectionAndInvitation(): Promise<{
      sectionId: string;
      invitationId: string;
      memberId: string;
    }> {
      // Owner creates the group and a Section under it with invites allowed.
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        memberInvitesAllowed: true,
      });

      // Member joins the Section, which grants them a MEMBER Role
      // Assignment for section.id - needed for the GROUP_INVITE permission
      // check below (Group has no GROUP_INVITE at all - see
      // group-role-permissions.map.ts).
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      const em = app.get(EntityManager).fork();
      const memberUser = await em.findOneOrFail(User, {
        clerkUserId: MEMBER_CLERK_ID,
      });
      const outsiderUser = await em.findOneOrFail(User, {
        clerkUserId: OUTSIDER_CLERK_ID,
      });

      // Member (with memberInvitesAllowed=true) invites the outsider
      const invRes = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/invitations`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({
          targetType: 'SECTION',
          invitedUserId: outsiderUser.id,
          invitedEmail: null,
        })
        .expect(201);

      return {
        sectionId: section.id,
        invitationId: (invRes.body as { id: string }).id,
        memberId: memberUser.id,
      };
    }

    it('allows the original inviter (MEMBER) to cancel their own invitation', async () => {
      const { sectionId, invitationId } = await setupSectionAndInvitation();

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${sectionId}/invitations/${invitationId}/cancel`,
        )
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);
    });

    it('allows the OWNER to cancel an invitation created by a MEMBER', async () => {
      const { sectionId, invitationId } = await setupSectionAndInvitation();

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${sectionId}/invitations/${invitationId}/cancel`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);
    });

    it('returns 403 when a plain MEMBER tries to cancel an invitation sent by a different MEMBER', async () => {
      // Owner creates the group+section; member1 invites outsider; second_outsider
      // (also a plain MEMBER) tries to cancel member1's invitation.
      const group = await createGroup(OWNER_TOKEN);
      const section = await createSection(OWNER_TOKEN, group.id, {
        memberInvitesAllowed: true,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      // second_outsider also joins, same reasoning (needs a Role to be a
      // "plain MEMBER" for the 403 check below, not a 404 not-found).
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${SECOND_OUTSIDER_TOKEN}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      const em = app.get(EntityManager).fork();
      const outsiderUser = await em.findOneOrFail(User, {
        clerkUserId: OUTSIDER_CLERK_ID,
      });

      // MEMBER creates an invitation for the outsider
      const invRes = await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/invitations`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({
          targetType: 'SECTION',
          invitedUserId: outsiderUser.id,
          invitedEmail: null,
        })
        .expect(201);

      const invitationId = (invRes.body as { id: string }).id;

      // SECOND_OUTSIDER (also MEMBER, but NOT the inviter) tries to cancel
      const cancelRes = await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/invitations/${invitationId}/cancel`,
        )
        .set('Authorization', `Bearer ${SECOND_OUTSIDER_TOKEN}`)
        .expect(403);

      expect(cancelRes.body).toMatchObject({
        code: 'INSUFFICIENT_PERMISSIONS_TO_CANCEL_INVITATION',
      });
    });
  });
});
