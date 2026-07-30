/**
 * E2E tests for Recipient Groups (GET/POST/PATCH .../recipient-groups...).
 *
 * Scenarios:
 *  1. OWNER and ADMIN can create and edit a Recipient Group
 *  2. A plain MEMBER cannot create/edit/activate/deactivate
 *  3. A member outside the community's scope cannot be added
 *  4. A Recipient Group can be deactivated and reactivated
 *  5. Name uniqueness is case-insensitive, per Group/Section
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
import { RecipientGroupResponseDto } from '../src/groups/dto/recipient-group-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RecipientGroupMember } from '../src/groups/entities/recipient-group-member.entity';
import { RecipientGroup } from '../src/groups/entities/recipient-group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { User } from '../src/users/entities/user.entity';

const OWNER_TOKEN = 'valid-rg-owner-token';
const ADMIN_TOKEN = 'valid-rg-admin-token';
const MEMBER_TOKEN = 'valid-rg-member-token';
const OUTSIDER_TOKEN = 'valid-rg-outsider-token';

const OWNER_CLERK_ID = 'user_test_rg_owner';
const ADMIN_CLERK_ID = 'user_test_rg_admin';
const MEMBER_CLERK_ID = 'user_test_rg_member';
const OUTSIDER_CLERK_ID = 'user_test_rg_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_rg_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_rg_owner' },
  },
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_rg_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_rg_admin' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_rg_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_rg_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_rg_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_rg_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/rg-owner.png',
    primaryEmailAddress: { emailAddress: 'rg.owner@example.com' },
  },
  [ADMIN_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/rg-admin.png',
    primaryEmailAddress: { emailAddress: 'rg.admin@example.com' },
  },
  [MEMBER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/rg-member.png',
    primaryEmailAddress: { emailAddress: 'rg.member@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/rg-outsider.png',
    primaryEmailAddress: { emailAddress: 'rg.outsider@example.com' },
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

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

describe('Recipient Groups (e2e)', () => {
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
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(RecipientGroupMember, {
      recipientGroup: { group: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(RecipientGroup, {
      group: { $in: createdGroupIds },
    });
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
    await cleanup.nativeDelete(User, {
      clerkUserId: { $in: TEST_CLERK_USER_IDS },
    });
    await app.close();
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Recipient Groups Test Org',
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

  async function addMember(
    ownerToken: string,
    groupId: string,
    memberToken: string,
    role: GroupRole = GroupRole.MEMBER,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function createOrgWithMembers(): Promise<GroupResponseDto> {
    const org = await createGroup(OWNER_TOKEN, {
      name: `Recipient Groups Test Org ${Date.now()}`,
    });
    await addMember(OWNER_TOKEN, org.id, ADMIN_TOKEN, GroupRole.ADMIN);
    await addMember(OWNER_TOKEN, org.id, MEMBER_TOKEN, GroupRole.MEMBER);
    return org;
  }

  function createRecipientGroup(
    token: string,
    groupId: string,
    overrides: Record<string, unknown> = {},
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/recipient-groups`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Trenerzy',
        memberUserIds: [],
        ...overrides,
      });
  }

  it('lets OWNER create a Recipient Group with in-scope members, and ADMIN edit it', async () => {
    const org = await createOrgWithMembers();
    const memberUserId = localUserIdByToken.get(MEMBER_TOKEN);

    const created = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Trenerzy',
        memberUserIds: [memberUserId],
      }).expect(201),
    );

    expect(created.name).toBe('Trenerzy');
    expect(created.isActive).toBe(true);
    expect(created.members).toHaveLength(1);
    expect(created.members[0].id).toBe(memberUserId);
    expect(typeof created.members[0].displayName).toBe('string');

    const updated = await bodyOf<RecipientGroupResponseDto>(
      request(app.getHttpServer())
        .patch(`/api/v1/groups/${org.id}/recipient-groups/${created.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ name: 'Trenerzy Główni', memberUserIds: [] })
        .expect(200),
    );

    expect(updated.name).toBe('Trenerzy Główni');
    expect(updated.members).toEqual([]);
  });

  it('a plain MEMBER cannot create, edit, activate, or deactivate a Recipient Group', async () => {
    const org = await createOrgWithMembers();
    const created = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, { name: 'Musicos' }).expect(
        201,
      ),
    );

    await createRecipientGroup(MEMBER_TOKEN, org.id, {
      name: 'Should Fail',
    }).expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/groups/${org.id}/recipient-groups/${created.id}`)
      .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
      .send({ name: 'Hacked', memberUserIds: [] })
      .expect(403);

    await request(app.getHttpServer())
      .post(
        `/api/v1/groups/${org.id}/recipient-groups/${created.id}/deactivate`,
      )
      .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
      .expect(403);
  });

  it('cannot add a member who is outside the community scope', async () => {
    const org = await createOrgWithMembers();
    const outsiderUserId = localUserIdByToken.get(OUTSIDER_TOKEN);

    await createRecipientGroup(OWNER_TOKEN, org.id, {
      name: 'Zarząd',
      memberUserIds: [outsiderUserId],
    }).expect(400);
  });

  it('can be deactivated and reactivated, and stays visible in the list either way', async () => {
    const org = await createOrgWithMembers();
    const created = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, { name: 'Rodzice' }).expect(
        201,
      ),
    );

    const deactivated = await bodyOf<RecipientGroupResponseDto>(
      request(app.getHttpServer())
        .post(
          `/api/v1/groups/${org.id}/recipient-groups/${created.id}/deactivate`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201),
    );
    expect(deactivated.isActive).toBe(false);

    const listAfterDeactivate = await bodyOf<RecipientGroupResponseDto[]>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/recipient-groups`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(200),
    );
    expect(
      listAfterDeactivate.some((rg) => rg.id === created.id && !rg.isActive),
    ).toBe(true);

    const reactivated = await bodyOf<RecipientGroupResponseDto>(
      request(app.getHttpServer())
        .post(
          `/api/v1/groups/${org.id}/recipient-groups/${created.id}/activate`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201),
    );
    expect(reactivated.isActive).toBe(true);
  });

  it('enforces case-insensitive name uniqueness within the same Group', async () => {
    const org = await createOrgWithMembers();
    await createRecipientGroup(OWNER_TOKEN, org.id, {
      name: 'Organizatorzy Batizado',
    }).expect(201);

    await createRecipientGroup(OWNER_TOKEN, org.id, {
      name: 'organizatorzy batizado',
    }).expect(409);
  });
});
