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
import { UserResponseDto } from '../src/users/dto/user-response.dto';
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { PublicUserProfileResponseDto } from '../src/users/dto/public-user-profile-response.dto';
import { FormalGroupResponseDto } from '../src/users/dto/formal-group-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { GraduationSystemResponseDto } from '../src/graduation/dto/graduation-system-response.dto';
import { RankResponseDto } from '../src/graduation/dto/rank-response.dto';
import { RankTrack } from '../src/graduation/enums/rank-track.enum';
import { FormalRankAssignmentResponseDto } from '../src/graduation/dto/formal-rank-assignment-response.dto';
import { CustomUserRankResponseDto } from '../src/graduation/dto/custom-user-rank-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { EventGuardianAssignment } from '../src/events/entities/event-guardian-assignment.entity';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';

// No fixed "ADMIN_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user (see USER_ALREADY_HAS_FORMAL_GROUP),
// and this file needs many independent Groups all administered by "some
// actor" across its tests, so createGroup() below mints a fresh, throwaway
// owner per call instead (see its own comment). Every token that remains
// here is a stable *subject* some assertion actually cares about (a
// specific viewer, target, or role holder), never a Group creator.
const TARGET_TOKEN = 'valid-profile-target-token';
const VIEWER_TOKEN = 'valid-profile-viewer-token';
const SECTION_ADMIN_TOKEN = 'valid-profile-section-admin-token';
const OTHER_ADMIN_TOKEN = 'valid-profile-other-admin-token';
const EVENT_ORGANIZER_TOKEN = 'valid-profile-event-organizer-token';
const EVENT_MODERATOR_TOKEN = 'valid-profile-event-moderator-token';
const EVENT_ATTENDEE_TOKEN = 'valid-profile-event-attendee-token';

const TOKENS = [
  TARGET_TOKEN,
  VIEWER_TOKEN,
  SECTION_ADMIN_TOKEN,
  OTHER_ADMIN_TOKEN,
  EVENT_ORGANIZER_TOKEN,
  EVENT_MODERATOR_TOKEN,
  EVENT_ATTENDEE_TOKEN,
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

describe('User Profile (e2e)', () => {
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
      const eventInCommunity = {
        event: {
          $or: [
            { communityGroup: { $in: createdGroupIds } },
            { communitySection: { $in: createdGroupIds } },
          ],
        },
      };
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
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below.
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
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
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
      // FIXTURE_CLERK_PROFILES, not a frozen snapshot - createGroup (via
      // createFreshGroupOwner) registers a fresh fixture user per call,
      // mutating FIXTURE_CLERK_PROFILES in place, so it must be read fresh
      // here to catch every one of them.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
  });

  // ─── Fixture helpers ────────────────────────────────────────────────────

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Capoeira Profile Test Group',
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
      name: 'Profile Test Section',
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

  // ADMIN_TOKEN is the only actor that ever creates a Group in this file -
  // its own FormalGroupAffiliation is never itself under test anywhere
  // here (it only ever acts as the administrator of whatever
  // Group/Section/Event a given test needs; the SUBJECT of every
  // formal-group assertion is always a different token, e.g.
  // EVENT_MODERATOR_TOKEN). GroupsService.create now allows at most one
  // active FormalGroupAffiliation per user (see
  // USER_ALREADY_HAS_FORMAL_GROUP), and ADMIN_TOKEN is reused across the
  // whole file (plus some tests need *several* Groups administered by "the
  // same actor" within one test) - so this mints a fresh, throwaway owner
  // per call instead of ever reusing ADMIN_TOKEN's own identity to create.
  // The returned object carries the full GroupResponseDto directly (so
  // `group.id`/`.name`/... keep working exactly as before) plus
  // `.token`/`.userId` for the fresh owner, for callers to act as
  // afterward.
  async function createGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto & { token: string; userId: string }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'profile-admin',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
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
    role?: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function leaveSection(
    sectionId: string,
    memberToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/leave`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(204);
  }

  async function grantSectionRole(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function attachGroupParent(
    token: string,
    childGroupId: string,
    parentGroupId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${childGroupId}/parent`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parentGroupId })
      .expect(201);
  }

  async function archiveGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  async function archiveSection(
    token: string,
    sectionId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  async function getOwnProfile(token: string): Promise<UserProfileResponseDto> {
    return bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function patchOwnProfile(
    token: string,
    body: Record<string, unknown>,
    expectStatus = 200,
  ): Promise<UserProfileResponseDto | HttpErrorResponse> {
    return bodyOf<UserProfileResponseDto | HttpErrorResponse>(
      request(app.getHttpServer())
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(expectStatus),
    );
  }

  async function getPublicProfile(
    viewerToken: string,
    targetUserId: string,
  ): Promise<PublicUserProfileResponseDto> {
    return bodyOf<PublicUserProfileResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/users/${targetUserId}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200),
    );
  }

  async function setFormalGroup(
    token: string,
    groupId: string,
    startedOn?: string,
    expectStatus = 200,
  ): Promise<FormalGroupResponseDto | HttpErrorResponse> {
    return bodyOf<FormalGroupResponseDto | HttpErrorResponse>(
      request(app.getHttpServer())
        .put('/api/v1/users/me/formal-group')
        .set('Authorization', `Bearer ${token}`)
        .send(startedOn ? { groupId, startedOn } : { groupId })
        .expect(expectStatus),
    );
  }

  function oneSegment(colorHex = '#123456') {
    return [{ position: 0, colorHex, proportion: 1 }];
  }

  // Mirrors formal-rank.e2e-spec.ts's own createGroupWithCatalog - a Group
  // with an active graduation system and one catalog Rank, owned by a
  // fresh throwaway owner (see createGroup's own comment on why). A fresh,
  // unique-named Group per call (avoids catalog collisions across tests in
  // this file). The returned `group` carries `.token` for callers that
  // need to act as its owner afterward (e.g. joinSection).
  async function createGroupWithCatalog(): Promise<{
    group: GroupResponseDto & { token: string; userId: string };
    section: SectionResponseDto;
    rank: RankResponseDto;
  }> {
    const group = await createGroup({
      name: `Formal Rank Catalog Group ${Date.now()}-${Math.random()}`,
    });
    const section = await createSection(group.token, group.id);
    await bodyOf<GraduationSystemResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/graduation-system`)
        .set('Authorization', `Bearer ${group.token}`)
        .expect(201),
    );
    const rank = await bodyOf<RankResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/ranks`)
        .set('Authorization', `Bearer ${group.token}`)
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
  ): Promise<FormalRankAssignmentResponseDto> {
    return bodyOf<FormalRankAssignmentResponseDto>(
      request(app.getHttpServer())
        .put('/api/v1/users/me/formal-rank')
        .set('Authorization', `Bearer ${token}`)
        .send({ rankId })
        .expect(200),
    );
  }

  async function endFormalRank(token: string): Promise<void> {
    await request(app.getHttpServer())
      .delete('/api/v1/users/me/formal-rank')
      .set('Authorization', `Bearer ${token}`);
  }

  async function setCustomRank(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<CustomUserRankResponseDto> {
    return bodyOf<CustomUserRankResponseDto>(
      request(app.getHttpServer())
        .put('/api/v1/users/me/custom-rank')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Corda Independente',
          description: null,
          track: RankTrack.ADULT,
          cordSegments: oneSegment(),
          ...overrides,
        })
        .expect(200),
    );
  }

  async function endCustomRank(token: string): Promise<void> {
    await request(app.getHttpServer())
      .delete('/api/v1/users/me/custom-rank')
      .set('Authorization', `Bearer ${token}`);
  }

  // ─── GET/PATCH /users/me/profile ────────────────────────────────────────

  describe('GET/PATCH /users/me/profile', () => {
    it('reads and updates the own profile, including profileComplete transitions', async () => {
      const initial = await getOwnProfile(SECTION_ADMIN_TOKEN);
      expect(initial.profileComplete).toBe(false);
      expect(initial.firstName).toBeNull();
      expect(initial.lastName).toBeNull();

      const afterFirstName = (await patchOwnProfile(SECTION_ADMIN_TOKEN, {
        firstName: 'Ada',
      })) as UserProfileResponseDto;
      expect(afterFirstName.firstName).toBe('Ada');
      expect(afterFirstName.profileComplete).toBe(false);

      const complete = (await patchOwnProfile(SECTION_ADMIN_TOKEN, {
        lastName: 'Lovelace',
        apelido: 'Formiga',
        capoeiraStartedAt: '2015-05-20',
      })) as UserProfileResponseDto;
      expect(complete.profileComplete).toBe(true);
      expect(complete.lastName).toBe('Lovelace');
      expect(complete.apelido).toBe('Formiga');
      expect(complete.capoeiraStartedAt).toBe('2015-05-20');

      const reread = await getOwnProfile(SECTION_ADMIN_TOKEN);
      expect(reread).toEqual(complete);
    });

    it('rejects clearing firstName/lastName to null or an empty string', async () => {
      const emptyString = (await patchOwnProfile(
        SECTION_ADMIN_TOKEN,
        { firstName: '' },
        400,
      )) as HttpErrorResponse;
      expect(emptyString.statusCode).toBe(400);

      const nullValue = (await patchOwnProfile(
        SECTION_ADMIN_TOKEN,
        { lastName: null },
        400,
      )) as HttpErrorResponse;
      expect(nullValue.statusCode).toBe(400);
    });

    it('updates and clears the private birthDate/phoneNumber, never exposing them publicly', async () => {
      const updated = (await patchOwnProfile(TARGET_TOKEN, {
        birthDate: '1990-03-15',
        phoneNumber: '  +48 600 100 200  ',
      })) as UserProfileResponseDto;
      expect(updated.birthDate).toBe('1990-03-15');
      expect(updated.phoneNumber).toBe('+48 600 100 200');

      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      const publicProfile = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(publicProfile).not.toHaveProperty('birthDate');
      expect(publicProfile).not.toHaveProperty('phoneNumber');

      const cleared = (await patchOwnProfile(TARGET_TOKEN, {
        birthDate: null,
        phoneNumber: null,
      })) as UserProfileResponseDto;
      expect(cleared.birthDate).toBeNull();
      expect(cleared.phoneNumber).toBeNull();
    });

    it('rejects an invalid phoneNumber or a future birthDate', async () => {
      for (const body of [
        { phoneNumber: 'abc123' },
        { phoneNumber: '123' },
        { phoneNumber: '' },
        { birthDate: '2999-01-01' },
        { birthDate: '1850-01-01' },
      ]) {
        const response = (await patchOwnProfile(
          SECTION_ADMIN_TOKEN,
          body,
          400,
        )) as HttpErrorResponse;
        expect(response.statusCode).toBe(400);
      }
    });

    it('never exposes email/phone/account fields on the own-profile DTO', async () => {
      const profile = await getOwnProfile(VIEWER_TOKEN);
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('phone');
      expect(profile).not.toHaveProperty('clerkUserId');
    });
  });

  // ─── Public profile visibility ──────────────────────────────────────────

  describe('GET /users/:userId/profile - basic identity is never privacy-gated', () => {
    it('always returns first name, last name and apelido to any viewer', async () => {
      await patchOwnProfile(TARGET_TOKEN, {
        firstName: 'Camila',
        lastName: 'Silva',
        apelido: 'Cobrinha',
      });
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;

      const profile = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(profile.displayName).toBe('Camila Silva');
      expect(profile.firstName).toBe('Camila');
      expect(profile.lastName).toBe('Silva');
      expect(profile.apelido).toBe('Cobrinha');
    });

    it('ignores the removed showFullName/showApelido fields - they can neither hide identity nor come back in the response', async () => {
      const own = (await patchOwnProfile(TARGET_TOKEN, {
        showFullName: false,
        showApelido: false,
      })) as UserProfileResponseDto;
      expect(own.privacy).not.toHaveProperty('showFullName');
      expect(own.privacy).not.toHaveProperty('showApelido');

      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      const profile = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(profile.firstName).toBe('Camila');
      expect(profile.apelido).toBe('Cobrinha');
    });

    it('never uses the publicCode or the account displayName in place of an existing name', async () => {
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      const profile = await getPublicProfile(VIEWER_TOKEN, targetId);
      const me = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );
      expect(profile.displayName).not.toBe(me.publicCode);
      expect(profile.displayName).toBe('Camila Silva');
    });

    it('never leaks email, phone, or account fields on the public DTO', async () => {
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      const profile = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('phone');
      expect(profile).not.toHaveProperty('clerkUserId');
    });

    // SavedLocation (see saved-locations.controller.ts) is private,
    // discovery-only data - it must never reach any profile endpoint, own
    // or public alike, regardless of how many locations the target has
    // saved or how they're named.
    it('never leaks city/country/location/savedLocations on the public DTO', async () => {
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      const profile = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(profile).not.toHaveProperty('city');
      expect(profile).not.toHaveProperty('country');
      expect(profile).not.toHaveProperty('location');
      expect(profile).not.toHaveProperty('latitude');
      expect(profile).not.toHaveProperty('longitude');
      expect(profile).not.toHaveProperty('savedLocations');
    });
  });

  // ─── sections list ───────────────────────────────────────────────────────

  describe('GET /users/:userId/profile - sections list', () => {
    // Sections are, deliberately, no longer role/status-blind here - a
    // capoeirista's *capoeira-representative* role in the Sections they
    // train in (Instrutor/Asystent) is meant to be part of their public
    // identity, same as it already is on their own Community Home
    // (myRoles). Still entirely behind the single showSections gate, same
    // as every other field of this shape. OWNER/ADMIN - app-authorization
    // facts, never capoeira identity - and the uninformative MEMBER are
    // never exposed here regardless of what the target's real
    // RoleAssignments say (see the dedicated OWNER/ADMIN test below).
    it('shows id/name/logoUrl/roles for active-membership sections, gated by showSections', async () => {
      const group = await createGroup({
        name: 'Sections List Group',
      });
      const sectionA = await createSection(group.token, group.id, {
        name: 'Sections List Section A',
      });
      const sectionB = await createSection(group.token, group.id, {
        name: 'Sections List Section B',
      });
      await joinSection(group.token, sectionA.id, VIEWER_TOKEN);
      await joinSection(group.token, sectionB.id, VIEWER_TOKEN);
      await grantSectionRole(
        group.token,
        sectionA.id,
        VIEWER_TOKEN,
        GroupRole.INSTRUCTOR,
      );

      const targetId = localUserIdByToken.get(VIEWER_TOKEN) as string;

      const hidden = await getPublicProfile(OTHER_ADMIN_TOKEN, targetId);
      expect(hidden.sections).toBeNull();

      await patchOwnProfile(VIEWER_TOKEN, { showSections: true });
      const visible = await getPublicProfile(OTHER_ADMIN_TOKEN, targetId);
      expect(visible.sections).toHaveLength(2);
      for (const ref of visible.sections ?? []) {
        expect(Object.keys(ref).sort()).toEqual([
          'id',
          'logoUrl',
          'name',
          'roles',
        ]);
      }

      const sectionARef = visible.sections?.find((s) => s.id === sectionA.id);
      const sectionBRef = visible.sections?.find((s) => s.id === sectionB.id);
      // sectionA's granted INSTRUCTOR shows; plain membership (sectionB, and
      // the baseline MEMBER role every membership also carries) shows
      // nothing - MEMBER is never itself informative enough to list.
      expect(sectionARef?.roles).toEqual([GroupRole.INSTRUCTOR]);
      expect(sectionBRef?.roles).toEqual([]);

      await patchOwnProfile(VIEWER_TOKEN, { showSections: false });
    });

    it('never exposes OWNER/ADMIN as a section role, even when the target genuinely holds it', async () => {
      const group = await createGroup({
        name: 'Sections List Admin Group',
      });
      const section = await createSection(group.token, group.id, {
        name: 'Sections List Admin Section',
      });
      await joinSection(group.token, section.id, VIEWER_TOKEN);
      await grantSectionRole(
        group.token,
        section.id,
        VIEWER_TOKEN,
        GroupRole.ADMIN,
      );

      const targetId = localUserIdByToken.get(VIEWER_TOKEN) as string;
      await patchOwnProfile(VIEWER_TOKEN, { showSections: true });

      const visible = await getPublicProfile(OTHER_ADMIN_TOKEN, targetId);
      const ref = visible.sections?.find((s) => s.id === section.id);
      expect(ref?.roles).toEqual([]);

      await patchOwnProfile(VIEWER_TOKEN, { showSections: false });
    });
  });

  // ─── formal rank ────────────────────────────────────────────────────────

  describe('GET /users/:userId/profile - formal rank', () => {
    it('is null when not visible, null when never set, and always visible to the owner regardless of showFormalRank', async () => {
      const { group, section, rank } = await createGroupWithCatalog();
      await joinSection(group.token, section.id, TARGET_TOKEN);
      await setFormalGroup(TARGET_TOKEN, group.id);
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;

      // Not yet set at all - null, not an error, regardless of the flag.
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: true });
      const beforeSet = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(beforeSet.formalRank).toBeNull();

      await setFormalRank(TARGET_TOKEN, rank.id);

      // Hidden by the flag - other viewers get null...
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: false });
      const hidden = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(hidden.formalRank).toBeNull();
      // ...but the owner still sees their own, unfiltered.
      const own = await getPublicProfile(TARGET_TOKEN, targetId);
      expect(own.formalRank).toEqual({
        name: 'Corda Crua',
        cordSegments: oneSegment(),
        sourceGroup: { id: group.id, name: group.name },
        startedOn: null,
      });

      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: true });
      const visible = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(visible.formalRank).toEqual(own.formalRank);

      await endFormalRank(TARGET_TOKEN);
      await request(app.getHttpServer())
        .delete('/api/v1/users/me/formal-group')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`);
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: false });
    });
  });

  // ─── independent (custom) rank ──────────────────────────────────────────

  describe('GET /users/:userId/profile - independent rank', () => {
    it('appears when set and visible, reusing the showFormalRank toggle, and is null when hidden, unset, or the owner clears it', async () => {
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      await endCustomRank(TARGET_TOKEN);

      // Not yet set at all - null, not an error, regardless of the flag.
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: true });
      const beforeSet = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(beforeSet.independentRank).toBeNull();

      await setCustomRank(TARGET_TOKEN, {
        name: 'Corda Independente',
        track: RankTrack.ADULT,
        cordSegments: oneSegment('#654321'),
      });

      // Hidden by the same flag that gates formalRank...
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: false });
      const hidden = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(hidden.independentRank).toBeNull();
      // ...but the owner still sees their own, unfiltered.
      const own = await getPublicProfile(TARGET_TOKEN, targetId);
      expect(own.independentRank).toEqual({
        name: 'Corda Independente',
        track: RankTrack.ADULT,
        cordSegments: oneSegment('#654321'),
      });

      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: true });
      const visible = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(visible.independentRank).toEqual(own.independentRank);

      await endCustomRank(TARGET_TOKEN);
      const afterDelete = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(afterDelete.independentRank).toBeNull();

      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: false });
    });

    it('shows the independent rank instead of a stale formal rank once the owner has left their formal group, or neither when there is no independent rank either', async () => {
      const { group, section, rank } = await createGroupWithCatalog();
      await joinSection(group.token, section.id, TARGET_TOKEN);
      await setFormalGroup(TARGET_TOKEN, group.id);
      await setFormalRank(TARGET_TOKEN, rank.id);
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: true });
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;

      // Still in the group - the formal rank shows normally, no
      // independent rank set yet.
      const whileInGroup = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(whileInGroup.formalRank?.name).toBe('Corda Crua');
      expect(whileInGroup.independentRank).toBeNull();

      // Leave the section and end the formal group affiliation.
      // endFormalGroup only ends the FormalGroupAffiliation row, not the
      // FormalRankAssignment itself (see UserProfileService.endFormalGroup
      // and getPublicProfile's own comment) - so without the public-
      // profile-local gate, formalRank would incorrectly keep showing the
      // stale rank forever.
      await leaveSection(section.id, TARGET_TOKEN);
      await request(app.getHttpServer())
        .delete('/api/v1/users/me/formal-group')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .expect(204);

      const afterLeavingNoIndependent = await getPublicProfile(
        VIEWER_TOKEN,
        targetId,
      );
      expect(afterLeavingNoIndependent.formalRank).toBeNull();
      expect(afterLeavingNoIndependent.independentRank).toBeNull();

      // Setting an independent rank afterwards shows that instead of the
      // (now-hidden) stale formal rank.
      await setCustomRank(TARGET_TOKEN, {
        name: 'Corda Depois do Grupo',
        track: RankTrack.ADULT,
        cordSegments: oneSegment('#111111'),
      });
      const afterLeavingWithIndependent = await getPublicProfile(
        VIEWER_TOKEN,
        targetId,
      );
      expect(afterLeavingWithIndependent.formalRank).toBeNull();
      expect(afterLeavingWithIndependent.independentRank?.name).toBe(
        'Corda Depois do Grupo',
      );

      await endCustomRank(TARGET_TOKEN);
      await endFormalRank(TARGET_TOKEN);
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: false });
    });
  });

  // ─── IDOR ────────────────────────────────────────────────────────────────

  describe('IDOR', () => {
    it('PATCH /users/me/profile only ever mutates the caller, never another user', async () => {
      const before = await getOwnProfile(OTHER_ADMIN_TOKEN);

      await patchOwnProfile(VIEWER_TOKEN, {
        firstName: 'Someone',
        lastName: 'Else',
      });

      const after = await getOwnProfile(OTHER_ADMIN_TOKEN);
      expect(after).toEqual(before);
    });

    it('GET /users/:userId/profile never returns private contact data regardless of who asks', async () => {
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      const profile = await getPublicProfile(OTHER_ADMIN_TOKEN, targetId);
      expect(profile).not.toHaveProperty('birthDate');
      expect(profile).not.toHaveProperty('phoneNumber');
    });
  });

  // ─── Formal Group ────────────────────────────────────────────────────────

  describe('PUT/DELETE /users/me/formal-group', () => {
    it('rejects setting a formal group with no active section membership anywhere in its hierarchy', async () => {
      const group = await createGroup({
        name: 'No Membership Formal Group',
      });
      const error = (await setFormalGroup(
        EVENT_ATTENDEE_TOKEN,
        group.id,
        undefined,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('accepts a section under a nested child group, not just direct sections', async () => {
      const root = await createGroup({
        name: 'Nested Formal Group Root',
      });
      const child = await createGroup({
        name: 'Nested Formal Group Child',
      });
      // attachGroupParent requires HIERARCHY_MANAGE (OWNER only) on *both*
      // nodes (see hierarchy-management.service.ts's assertHierarchyManage)
      // - root and child are two independent fresh owners here, so grant
      // root's owner ADMIN on child, then transfer child's ownership to
      // them (never touches FormalGroupAffiliation - see
      // role-assignments.service.ts) so a single actor can perform the
      // attach, same reasoning as hierarchy.e2e-spec.ts's
      // createGroupOwnedByA.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${child.token}`)
        .send({ userId: root.userId, role: 'ADMIN' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/transfer-ownership`)
        .set('Authorization', `Bearer ${child.token}`)
        .send({ newOwnerUserId: root.userId })
        .expect(201);

      await attachGroupParent(root.token, child.id, root.id);
      const nestedSection = await createSection(root.token, child.id, {
        name: 'Nested Formal Group Section',
      });
      await joinSection(root.token, nestedSection.id, EVENT_ORGANIZER_TOKEN);

      const result = (await setFormalGroup(
        EVENT_ORGANIZER_TOKEN,
        root.id,
      )) as FormalGroupResponseDto;
      expect(result.groupId).toBe(root.id);
      expect(result.name).toBe('Nested Formal Group Root');
    });

    it('supports many SectionMemberships under a single formal Group, and switches atomically between two formal Groups', async () => {
      const groupA = await createGroup({ name: 'Formal Group A' });
      const sectionA1 = await createSection(groupA.token, groupA.id, {
        name: 'Formal Group A Section 1',
      });
      const sectionA2 = await createSection(groupA.token, groupA.id, {
        name: 'Formal Group A Section 2',
      });
      const groupB = await createGroup({ name: 'Formal Group B' });
      const sectionB = await createSection(groupB.token, groupB.id, {
        name: 'Formal Group B Section',
      });

      await joinSection(groupA.token, sectionA1.id, EVENT_MODERATOR_TOKEN);
      await joinSection(groupA.token, sectionA2.id, EVENT_MODERATOR_TOKEN);
      await joinSection(groupB.token, sectionB.id, EVENT_MODERATOR_TOKEN);

      const setA = (await setFormalGroup(
        EVENT_MODERATOR_TOKEN,
        groupA.id,
        '2018-03-01',
      )) as FormalGroupResponseDto;
      expect(setA.groupId).toBe(groupA.id);
      expect(setA.startedOn).toBe('2018-03-01');
      expect(setA.endedOn).toBeNull();

      const own = await getOwnProfile(EVENT_MODERATOR_TOKEN);
      expect(own.formalGroup?.groupId).toBe(groupA.id);

      const setB = (await setFormalGroup(
        EVENT_MODERATOR_TOKEN,
        groupB.id,
        '2024-01-15',
      )) as FormalGroupResponseDto;
      expect(setB.groupId).toBe(groupB.id);
      expect(setB.endedOn).toBeNull();

      const em = app.get(EntityManager).fork();
      const rows = await em.find(FormalGroupAffiliation, {
        user: localUserIdByToken.get(EVENT_MODERATOR_TOKEN),
      });
      expect(rows).toHaveLength(2);
      const activeRows = rows.filter((r) => r.endedOn === null);
      expect(activeRows).toHaveLength(1);
      expect(activeRows[0].group.id).toBe(groupB.id);
      const endedRow = rows.find((r) => r.group.id === groupA.id);
      expect(endedRow?.endedOn).not.toBeNull();
    });

    it('rejects a future-dated startedOn', async () => {
      const group = await createGroup({
        name: 'Future Started On Group',
      });
      const section = await createSection(group.token, group.id, {
        name: 'Future Started On Section',
      });
      await joinSection(group.token, section.id, OTHER_ADMIN_TOKEN);

      const error = (await setFormalGroup(
        OTHER_ADMIN_TOKEN,
        group.id,
        '2099-01-01',
        400,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(400);
    });

    it('rejects an archived group as a formal group', async () => {
      const group = await createGroup({
        name: 'Archived Formal Group',
      });
      const section = await createSection(group.token, group.id, {
        name: 'Archived Formal Group Section',
      });
      await joinSection(group.token, section.id, VIEWER_TOKEN);
      await archiveGroup(group.token, group.id);

      const error = (await setFormalGroup(
        VIEWER_TOKEN,
        group.id,
        undefined,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('rejects when the only qualifying membership is in an archived section, but accepts once an active section also qualifies', async () => {
      const group = await createGroup({
        name: 'Archived Section Formal Group',
      });
      const archivedSection = await createSection(group.token, group.id, {
        name: 'Archived Formal Section',
      });
      const activeSection = await createSection(group.token, group.id, {
        name: 'Active Formal Section',
      });
      await joinSection(group.token, archivedSection.id, EVENT_ATTENDEE_TOKEN);
      await archiveSection(group.token, archivedSection.id);

      const stillRejected = (await setFormalGroup(
        EVENT_ATTENDEE_TOKEN,
        group.id,
        undefined,
        409,
      )) as HttpErrorResponse;
      expect(stillRejected.statusCode).toBe(409);

      await joinSection(group.token, activeSection.id, EVENT_ATTENDEE_TOKEN);
      const accepted = (await setFormalGroup(
        EVENT_ATTENDEE_TOKEN,
        group.id,
      )) as FormalGroupResponseDto;
      expect(accepted.groupId).toBe(group.id);
    });

    it('DELETE ends the active affiliation, and repeating it 404s', async () => {
      const group = await createGroup({
        name: 'End Formal Group',
      });
      const section = await createSection(group.token, group.id, {
        name: 'End Formal Group Section',
      });
      await joinSection(group.token, section.id, SECTION_ADMIN_TOKEN);
      // SECTION_ADMIN_TOKEN already has a formal group set from an earlier
      // describe block in this file - switching first proves the DELETE
      // path independently of that history.
      await setFormalGroup(SECTION_ADMIN_TOKEN, group.id);

      await request(app.getHttpServer())
        .delete('/api/v1/users/me/formal-group')
        .set('Authorization', `Bearer ${SECTION_ADMIN_TOKEN}`)
        .expect(204);

      const profile = await getOwnProfile(SECTION_ADMIN_TOKEN);
      expect(profile.formalGroup).toBeNull();

      const repeat = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete('/api/v1/users/me/formal-group')
          .set('Authorization', `Bearer ${SECTION_ADMIN_TOKEN}`)
          .expect(404),
      );
      expect(repeat.statusCode).toBe(404);
    });

    it('does not end the formal Group affiliation when the user leaves their last qualifying section', async () => {
      const group = await createGroup({
        name: 'Leave Does Not End Formal Group',
      });
      const section = await createSection(group.token, group.id, {
        name: 'Leave Does Not End Formal Group Section',
      });
      await joinSection(group.token, section.id, OTHER_ADMIN_TOKEN);
      const set = (await setFormalGroup(
        OTHER_ADMIN_TOKEN,
        group.id,
      )) as FormalGroupResponseDto;
      expect(set.groupId).toBe(group.id);

      await leaveSection(section.id, OTHER_ADMIN_TOKEN);

      const profile = await getOwnProfile(OTHER_ADMIN_TOKEN);
      expect(profile.formalGroup?.groupId).toBe(group.id);
      expect(profile.formalGroup?.endedOn).toBeNull();
    });
  });
});
