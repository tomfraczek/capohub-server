/**
 * E2E tests for Recipient Groups (GET/POST/PATCH .../recipient-groups...).
 *
 * Scenarios:
 *  1. OWNER and ADMIN can create and edit a Recipient Group
 *  2. A plain MEMBER cannot create/edit/activate/deactivate
 *  3. A member outside the community's scope cannot be added
 *  4. A Recipient Group can be deactivated and reactivated
 *  5. Name uniqueness is case-insensitive, per Group/Section
 *  6. Name uniqueness only applies among *active* Recipient Groups - a
 *     deactivated one's name becomes free for a brand new Recipient Group,
 *     without disturbing the deactivated row or any historical
 *     Announcement built on it
 *  7. Two simultaneously *active* Recipient Groups still cannot share a
 *     name, including when reactivating one whose name was reused by a
 *     newer, still-active Recipient Group in the meantime
 *  8. GET .../recipient-groups/eligible-members returns exactly the set
 *     create()/update() would accept - for a Group, its members; for a
 *     Section, only those holding a Role Assignment for that exact
 *     Section (no inheritance) - searchable, paginated, sorted
 *     deterministically, with no cross-resource leakage
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
import { RecipientGroupEligibleMembersResponseDto } from '../src/groups/dto/recipient-group-eligible-member.dto';
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
import { AnnouncementResponseDto } from '../src/announcements/dto/announcement-response.dto';
import { Announcement } from '../src/announcements/entities/announcement.entity';
import { AnnouncementRecipient } from '../src/announcements/entities/announcement-recipient.entity';
import { AnnouncementRead } from '../src/announcements/entities/announcement-read.entity';

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
    await cleanup.nativeDelete(AnnouncementRead, {
      announcement: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(AnnouncementRecipient, {
      announcement: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(Announcement, {
      community: { $in: createdGroupIds },
    });
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

  async function createSection(
    token: string,
    parentGroupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(
          groupPayload({
            name: `Recipient Groups Test Section ${Date.now()}-${Math.random()}`,
            ...overrides,
          }),
        )
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function findMembershipId(
    ownerToken: string,
    rootGroupId: string,
    userId: string | undefined,
  ): Promise<string> {
    const members = await bodyOf<{ id: string; user: { id: string } }[]>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${rootGroupId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200),
    );
    const membership = members.find((m) => m.user.id === userId);
    if (!membership) {
      throw new Error(`No membership found for user ${userId}`);
    }
    return membership.id;
  }

  async function grantRole(
    granterToken: string,
    groupId: string,
    membershipId: string,
    role: GroupRole = GroupRole.MEMBER,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${granterToken}`)
      .send({ membershipId, role })
      .expect(201);
  }

  async function getDisplayName(token: string): Promise<string> {
    const me = await bodyOf<{ displayName: string }>(
      request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
    return me.displayName;
  }

  function getEligibleMembers(
    token: string,
    resourcePathPrefix: string,
    qs = '',
  ): request.Test {
    return request(app.getHttpServer())
      .get(`${resourcePathPrefix}/recipient-groups/eligible-members${qs}`)
      .set('Authorization', `Bearer ${token}`);
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

  function futureIso(daysFromNow = 30): string {
    return new Date(
      Date.now() + daysFromNow * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  function createAnnouncement(
    token: string,
    groupId: string,
    recipientGroupId: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/announcements`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Dla wybranej grupy odbiorców',
        body: 'Treść',
        recipientGroupId,
        isPinned: false,
        expiresAt: futureIso(),
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

  it('enforces case-insensitive name uniqueness among active Recipient Groups within the same Group', async () => {
    const org = await createOrgWithMembers();
    await createRecipientGroup(OWNER_TOKEN, org.id, {
      name: 'Organizatorzy Batizado',
    }).expect(201);

    await createRecipientGroup(OWNER_TOKEN, org.id, {
      name: 'organizatorzy batizado',
    }).expect(409);
  });

  it('frees the name for a brand new Recipient Group once the old one holding it is deactivated', async () => {
    const org = await createOrgWithMembers();
    const original = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, { name: 'Trenerzy' }).expect(
        201,
      ),
    );

    await request(app.getHttpServer())
      .post(
        `/api/v1/groups/${org.id}/recipient-groups/${original.id}/deactivate`,
      )
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(201);

    // No 409 - the old, now-inactive "Trenerzy" no longer occupies the name.
    const recreated = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, { name: 'Trenerzy' }).expect(
        201,
      ),
    );
    expect(recreated.id).not.toBe(original.id);
    expect(recreated.isActive).toBe(true);

    // Both rows remain - the old one is never deleted or renamed.
    const list = await bodyOf<RecipientGroupResponseDto[]>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/recipient-groups`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200),
    );
    const trenerzyRows = list.filter((rg) => rg.name === 'Trenerzy');
    expect(trenerzyRows).toHaveLength(2);
    expect(trenerzyRows.find((rg) => rg.id === original.id)?.isActive).toBe(
      false,
    );
    expect(trenerzyRows.find((rg) => rg.id === recreated.id)?.isActive).toBe(
      true,
    );

    // Two *active* "Trenerzy" is still rejected, case-insensitively.
    await createRecipientGroup(OWNER_TOKEN, org.id, {
      name: 'TRENERZY',
    }).expect(409);
  });

  it('rejects reactivating a Recipient Group whose name was reused by a newer, still-active one', async () => {
    const org = await createOrgWithMembers();
    const original = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, { name: 'Rada' }).expect(201),
    );
    await request(app.getHttpServer())
      .post(
        `/api/v1/groups/${org.id}/recipient-groups/${original.id}/deactivate`,
      )
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(201);

    await createRecipientGroup(OWNER_TOKEN, org.id, { name: 'Rada' }).expect(
      201,
    );

    // Reactivating the original would now collide with the newer active one.
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${org.id}/recipient-groups/${original.id}/activate`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(409);
  });

  it("reusing a deactivated Recipient Group name for a new one never touches the old one's historical Announcement snapshot or visibility", async () => {
    const org = await createOrgWithMembers();
    const memberUserId = localUserIdByToken.get(MEMBER_TOKEN);
    const original = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Reused Name',
        memberUserIds: [memberUserId],
      }).expect(201),
    );
    const announcement = await bodyOf<AnnouncementResponseDto>(
      createAnnouncement(OWNER_TOKEN, org.id, original.id).expect(201),
    );

    await request(app.getHttpServer())
      .post(
        `/api/v1/groups/${org.id}/recipient-groups/${original.id}/deactivate`,
      )
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(201);

    const newGroup = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Reused Name',
        memberUserIds: [],
      }).expect(201),
    );
    expect(newGroup.id).not.toBe(original.id);

    // The Announcement still points at the original (now-inactive) group,
    // never silently re-associated with the new one that reused its name.
    // Read by the original snapshot member - the *only* viewer this active
    // RECIPIENT_GROUP-type Announcement is visible to (not even OWNER
    // bypasses the snapshot check for an active one - only for an expired
    // one via archive access, see AnnouncementsService.assertReadable).
    const detail = await bodyOf<AnnouncementResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${announcement.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200),
    );
    expect(detail.recipientGroupId).toBe(original.id);

    const em = app.get(EntityManager).fork();
    const snapshot = await em.find(AnnouncementRecipient, {
      announcement: announcement.id,
    });
    expect(snapshot.map((row) => row.user.id)).toEqual([memberUserId]);
  });

  it('allows the same name to be reused across two different Groups', async () => {
    const orgA = await createOrgWithMembers();
    const orgB = await createOrgWithMembers();

    await createRecipientGroup(OWNER_TOKEN, orgA.id, {
      name: 'Zarząd',
    }).expect(201);

    // Uniqueness is scoped per-Group, not global - the same name in an
    // unrelated Group must not collide.
    await createRecipientGroup(OWNER_TOKEN, orgB.id, {
      name: 'Zarząd',
    }).expect(201);
  });

  it('rejects duplicate ids within memberUserIds', async () => {
    const org = await createOrgWithMembers();
    const memberUserId = localUserIdByToken.get(MEMBER_TOKEN);

    await createRecipientGroup(OWNER_TOKEN, org.id, {
      name: 'Duplicated members',
      memberUserIds: [memberUserId, memberUserId],
    }).expect(400);
  });

  it('rejects an out-of-scope member on update, not just on create', async () => {
    const org = await createOrgWithMembers();
    const outsiderUserId = localUserIdByToken.get(OUTSIDER_TOKEN);
    const created = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Zespół',
      }).expect(201),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/groups/${org.id}/recipient-groups/${created.id}`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ name: 'Zespół', memberUserIds: [outsiderUserId] })
      .expect(400);
  });

  it('GET :recipientGroupId returns the detail with populated members', async () => {
    const org = await createOrgWithMembers();
    const memberUserId = localUserIdByToken.get(MEMBER_TOKEN);
    const created = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Detale',
        memberUserIds: [memberUserId],
      }).expect(201),
    );

    const detail = await bodyOf<RecipientGroupResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/recipient-groups/${created.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(200),
    );

    expect(detail.id).toBe(created.id);
    expect(detail.name).toBe('Detale');
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0].id).toBe(memberUserId);
  });

  it('returns 404 for a nonexistent recipientGroupId on getById, update, activate, and deactivate', async () => {
    const org = await createOrgWithMembers();
    const fakeId = '00000000-0000-0000-0000-000000000000';

    await request(app.getHttpServer())
      .get(`/api/v1/groups/${org.id}/recipient-groups/${fakeId}`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/groups/${org.id}/recipient-groups/${fakeId}`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ name: 'Nope', memberUserIds: [] })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/groups/${org.id}/recipient-groups/${fakeId}/activate`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/groups/${org.id}/recipient-groups/${fakeId}/deactivate`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(404);
  });

  it('returns 404, not 403, for a caller with no membership in this Group at all', async () => {
    const org = await createOrgWithMembers();
    const created = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Prywatne',
      }).expect(201),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/groups/${org.id}/recipient-groups`)
      .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/groups/${org.id}/recipient-groups/${created.id}`)
      .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
      .expect(404);

    await createRecipientGroup(OUTSIDER_TOKEN, org.id, {
      name: 'Should not be created',
    }).expect(404);
  });

  it('deactivating or editing a Recipient Group already used by a published Announcement never affects that Announcement', async () => {
    const org = await createOrgWithMembers();
    const memberUserId = localUserIdByToken.get(MEMBER_TOKEN);
    const recipientGroup = await bodyOf<RecipientGroupResponseDto>(
      createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Grupa dla ogłoszenia',
        memberUserIds: [memberUserId],
      }).expect(201),
    );

    const announcement = await bodyOf<AnnouncementResponseDto>(
      createAnnouncement(OWNER_TOKEN, org.id, recipientGroup.id).expect(201),
    );

    const em = app.get(EntityManager).fork();
    const snapshotBefore = await em.find(AnnouncementRecipient, {
      announcement: announcement.id,
    });
    expect(snapshotBefore.map((row) => row.user.id)).toEqual([memberUserId]);

    // Editing the Recipient Group's members afterwards must not touch the
    // already-published Announcement's immutable snapshot.
    await request(app.getHttpServer())
      .patch(`/api/v1/groups/${org.id}/recipient-groups/${recipientGroup.id}`)
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ name: 'Grupa dla ogłoszenia', memberUserIds: [] })
      .expect(200);

    const snapshotAfterEdit = await em.find(
      AnnouncementRecipient,
      { announcement: announcement.id },
      { refresh: true },
    );
    expect(snapshotAfterEdit.map((row) => row.user.id)).toEqual([memberUserId]);

    // The snapshot member can still open/read the Announcement even though
    // the Recipient Group they were removed from no longer lists them.
    await request(app.getHttpServer())
      .get(`/api/v1/groups/${org.id}/announcements/${announcement.id}`)
      .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
      .expect(200);

    // Deactivating the Recipient Group only blocks selecting it for a *new*
    // Announcement (see loadActiveForCommunity) - it must not retroactively
    // hide or break the already-published one.
    await request(app.getHttpServer())
      .post(
        `/api/v1/groups/${org.id}/recipient-groups/${recipientGroup.id}/deactivate`,
      )
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/groups/${org.id}/announcements/${announcement.id}`)
      .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
      .expect(200);

    const list = await bodyOf<{ items: AnnouncementResponseDto[] }>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200),
    );
    expect(list.items.some((item) => item.id === announcement.id)).toBe(true);

    // And, as documented, the deactivated group can no longer be selected
    // for a brand new Announcement.
    await createAnnouncement(OWNER_TOKEN, org.id, recipientGroup.id).expect(
      409,
    );
  });

  describe('GET .../recipient-groups/eligible-members', () => {
    it('returns every eligible member of a root Group, minimally shaped, sorted deterministically, with no sensitive fields', async () => {
      const org = await createOrgWithMembers();
      const ownerUserId = localUserIdByToken.get(OWNER_TOKEN);
      const adminUserId = localUserIdByToken.get(ADMIN_TOKEN);
      const memberUserId = localUserIdByToken.get(MEMBER_TOKEN);

      const result = await bodyOf<RecipientGroupEligibleMembersResponseDto>(
        getEligibleMembers(OWNER_TOKEN, `/api/v1/groups/${org.id}`).expect(200),
      );

      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
      expect(result.items.map((i) => i.id).sort()).toEqual(
        [ownerUserId, adminUserId, memberUserId].sort(),
      );

      for (const item of result.items) {
        expect(Object.keys(item).sort()).toEqual([
          'avatarUrl',
          'displayName',
          'id',
        ]);
        expect(item).not.toHaveProperty('email');
      }

      const sorted = [...result.items].sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName) ||
          a.id.localeCompare(b.id),
      );
      expect(result.items.map((i) => i.id)).toEqual(sorted.map((i) => i.id));
    });

    it('for a Section, returns only members with a Role Assignment for that exact Section - a root-only Group member is excluded', async () => {
      const org = await createOrgWithMembers();
      const section = await createSection(OWNER_TOKEN, org.id);
      const memberMembershipId = await findMembershipId(
        OWNER_TOKEN,
        org.id,
        localUserIdByToken.get(MEMBER_TOKEN),
      );
      await grantRole(
        OWNER_TOKEN,
        section.id,
        memberMembershipId,
        GroupRole.MEMBER,
      );

      const result = await bodyOf<RecipientGroupEligibleMembersResponseDto>(
        getEligibleMembers(
          OWNER_TOKEN,
          `/api/v1/sections/${section.id}`,
        ).expect(200),
      );

      const ids = result.items.map((i) => i.id);
      // OWNER created the Section, so they hold OWNER there automatically;
      // MEMBER was just granted a Role there explicitly.
      expect(ids.sort()).toEqual(
        [
          localUserIdByToken.get(OWNER_TOKEN),
          localUserIdByToken.get(MEMBER_TOKEN),
        ].sort(),
      );
      // ADMIN is a root-org member but was never granted any Role for this
      // exact Section - membership alone must not be enough (ADR-004).
      expect(ids).not.toContain(localUserIdByToken.get(ADMIN_TOKEN));
      expect(result.total).toBe(2);
    });

    it('excludes a user outside the community, and returns 404 (not the candidate list) for a caller with no access at all', async () => {
      const org = await createOrgWithMembers();

      const result = await bodyOf<RecipientGroupEligibleMembersResponseDto>(
        getEligibleMembers(OWNER_TOKEN, `/api/v1/groups/${org.id}`).expect(200),
      );
      expect(result.items.map((i) => i.id)).not.toContain(
        localUserIdByToken.get(OUTSIDER_TOKEN),
      );

      await getEligibleMembers(
        OUTSIDER_TOKEN,
        `/api/v1/groups/${org.id}`,
      ).expect(404);
    });

    it('supports search by displayName', async () => {
      const org = await createOrgWithMembers();
      const memberDisplayName = await getDisplayName(MEMBER_TOKEN);
      const distinctiveFragment = memberDisplayName.slice(-4);

      const result = await bodyOf<RecipientGroupEligibleMembersResponseDto>(
        getEligibleMembers(
          OWNER_TOKEN,
          `/api/v1/groups/${org.id}`,
          `?search=${encodeURIComponent(distinctiveFragment)}`,
        ).expect(200),
      );

      expect(
        result.items.every((item) =>
          item.displayName
            .toLowerCase()
            .includes(distinctiveFragment.toLowerCase()),
        ),
      ).toBe(true);
      expect(result.items.map((i) => i.id)).toContain(
        localUserIdByToken.get(MEMBER_TOKEN),
      );
    });

    it('paginates with a correct total/hasMore', async () => {
      const org = await createOrgWithMembers();

      const page1 = await bodyOf<RecipientGroupEligibleMembersResponseDto>(
        getEligibleMembers(
          OWNER_TOKEN,
          `/api/v1/groups/${org.id}`,
          '?limit=2&offset=0',
        ).expect(200),
      );
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(3);
      expect(page1.hasMore).toBe(true);

      const page2 = await bodyOf<RecipientGroupEligibleMembersResponseDto>(
        getEligibleMembers(
          OWNER_TOKEN,
          `/api/v1/groups/${org.id}`,
          '?limit=2&offset=2',
        ).expect(200),
      );
      expect(page2.items).toHaveLength(1);
      expect(page2.total).toBe(3);
      expect(page2.hasMore).toBe(false);

      const ids = [...page1.items, ...page2.items].map((i) => i.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('rejects limit > 100 and a negative offset', async () => {
      const org = await createOrgWithMembers();

      await getEligibleMembers(
        OWNER_TOKEN,
        `/api/v1/groups/${org.id}`,
        '?limit=101',
      ).expect(400);
      await getEligibleMembers(
        OWNER_TOKEN,
        `/api/v1/groups/${org.id}`,
        '?offset=-1',
      ).expect(400);
    });

    it('prevents cross-resource access - a member of one Group/Section cannot read another Group/Section eligible-members list', async () => {
      const orgA = await createOrgWithMembers();
      // orgB deliberately does NOT add ADMIN_TOKEN/MEMBER_TOKEN - they only
      // belong to orgA.
      const orgB = await createGroup(OWNER_TOKEN, {
        name: `Recipient Groups Test Org B ${Date.now()}`,
      });

      await getEligibleMembers(
        MEMBER_TOKEN,
        `/api/v1/groups/${orgB.id}`,
      ).expect(404);

      const sectionA = await createSection(OWNER_TOKEN, orgA.id);
      const sectionB = await createSection(OWNER_TOKEN, orgB.id);
      const memberMembershipIdInA = await findMembershipId(
        OWNER_TOKEN,
        orgA.id,
        localUserIdByToken.get(MEMBER_TOKEN),
      );
      await grantRole(
        OWNER_TOKEN,
        sectionA.id,
        memberMembershipIdInA,
        GroupRole.MEMBER,
      );

      // MEMBER_TOKEN holds a Role in sectionA but has no access to orgB or
      // sectionB at all.
      await getEligibleMembers(
        MEMBER_TOKEN,
        `/api/v1/sections/${sectionB.id}`,
      ).expect(404);
    });

    it('contract parity: every returned candidate is accepted by create/update, and a user missing from the list is still rejected', async () => {
      const org = await createOrgWithMembers();

      const eligible = await bodyOf<RecipientGroupEligibleMembersResponseDto>(
        getEligibleMembers(OWNER_TOKEN, `/api/v1/groups/${org.id}`).expect(200),
      );
      const eligibleIds = eligible.items.map((i) => i.id);
      expect(eligibleIds.length).toBeGreaterThan(0);

      const created = await bodyOf<RecipientGroupResponseDto>(
        createRecipientGroup(OWNER_TOKEN, org.id, {
          name: 'Parity Check',
          memberUserIds: eligibleIds,
        }).expect(201),
      );
      expect(created.members.map((m) => m.id).sort()).toEqual(
        [...eligibleIds].sort(),
      );

      const updated = await bodyOf<RecipientGroupResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${org.id}/recipient-groups/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ name: 'Parity Check', memberUserIds: eligibleIds })
          .expect(200),
      );
      expect(updated.members.map((m) => m.id).sort()).toEqual(
        [...eligibleIds].sort(),
      );

      // A user absent from the eligible-members list is still rejected by
      // both create and update - the two paths cannot disagree.
      const outsiderId = localUserIdByToken.get(OUTSIDER_TOKEN);
      expect(eligibleIds).not.toContain(outsiderId);

      await createRecipientGroup(OWNER_TOKEN, org.id, {
        name: 'Should Fail',
        memberUserIds: [outsiderId],
      }).expect(400);

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${org.id}/recipient-groups/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ name: 'Parity Check', memberUserIds: [outsiderId] })
        .expect(400);
    });
  });
});
