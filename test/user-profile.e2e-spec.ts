import { setAndConfirmFormalRank } from './formal-rank-confirm.helper';
import { FormalRankRequest } from '../src/graduation/entities/formal-rank-request.entity';
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
import {
  createFreshGroupOwner,
  forceGroupOwnerForFixture,
} from './fresh-group-owner.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { UserResponseDto } from '../src/users/dto/user-response.dto';
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { PublicUserProfileResponseDto } from '../src/users/dto/public-user-profile-response.dto';
import {
  FormalGroupResponseDto,
  PendingFormalGroupRequestResponseDto,
} from '../src/users/dto/formal-group-response.dto';
import { MembershipRequestResponseDto } from '../src/groups/dto/membership-request-response.dto';
import { MembershipRequest } from '../src/groups/entities/membership-request.entity';
import { MembershipRequestStatus } from '../src/groups/enums/membership-request-status.enum';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
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
      // Group join requests (and the notifications they raised) reference
      // both the Groups and the fixture Users - cleared first.
      await cleanup.nativeDelete(Notification, {
        contextGroup: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(MembershipRequest, {
        $or: [
          { targetGroup: { $in: createdGroupIds } },
          { targetSection: { $in: createdGroupIds } },
        ],
      });
      // FormalRankRequest.group/rank have no delete cascade - cleared
      // before the Groups/Ranks themselves.
      await cleanup.nativeDelete(FormalRankRequest, {
        group: { $in: createdGroupIds },
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

  // Group -> Group links can no longer be created through the API (Groups
  // are always top-level - see GroupHierarchyService.rejectGroupAsChild),
  // but legacy rows can still carry one, so this writes it directly.
  async function attachLegacyGroupParent(
    childGroupId: string,
    parentGroupId: string,
  ): Promise<void> {
    await app
      .get(EntityManager)
      .fork()
      .nativeUpdate(
        Group,
        { id: childGroupId },
        { parentGroup: parentGroupId },
      );
  }

  async function archiveGroup(token: string, groupId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/archive`)
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
          nameFemale: 'Corda Crua',
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
    return setAndConfirmFormalRank(app, token, { rankId });
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
        // No date sent - defaults to today (FormalRankService.setCurrent).
        startedOn: new Date().toISOString().slice(0, 10),
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
      // The independent rank is read-only while a formal Group is set.
      await request(app.getHttpServer())
        .delete('/api/v1/users/me/formal-group')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`);
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

    // Leaving (or changing) the formal Group never hides the rank earned
    // there - it stays the user's rank, labelled with its own Group, until
    // they hold a newer one. Setting an independent rank afterwards (allowed
    // only without a formal Group) makes that the current one and ends the
    // formal one as history.
    it('keeps showing the formal rank after the owner left their formal group, until a newer independent rank replaces it', async () => {
      const { group, section, rank } = await createGroupWithCatalog();
      await joinSection(group.token, section.id, TARGET_TOKEN);
      await setFormalGroup(TARGET_TOKEN, group.id);
      await setFormalRank(TARGET_TOKEN, rank.id);
      await patchOwnProfile(TARGET_TOKEN, { showFormalRank: true });
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;

      const whileInGroup = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(whileInGroup.formalRank?.name).toBe('Corda Crua');
      expect(whileInGroup.independentRank).toBeNull();

      await leaveSection(section.id, TARGET_TOKEN);
      await request(app.getHttpServer())
        .delete('/api/v1/users/me/formal-group')
        .set('Authorization', `Bearer ${TARGET_TOKEN}`)
        .expect(204);

      const afterLeaving = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(afterLeaving.formalRank?.name).toBe('Corda Crua');
      expect(afterLeaving.formalRank?.sourceGroup?.id).toBe(group.id);
      expect(afterLeaving.independentRank).toBeNull();

      await setCustomRank(TARGET_TOKEN, {
        name: 'Corda Depois do Grupo',
        track: RankTrack.ADULT,
        cordSegments: oneSegment('#111111'),
      });
      const withIndependent = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(withIndependent.formalRank).toBeNull();
      expect(withIndependent.independentRank?.name).toBe(
        'Corda Depois do Grupo',
      );

      await endCustomRank(TARGET_TOKEN);
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
    // The formal Group and training in its Sections are independent: with
    // joinRequiresApproval off, no Section membership, follow or any other
    // prior relation is needed.
    it('sets a formal group immediately with no section membership, follow or other relation to it', async () => {
      const group = await createGroup({
        name: 'No Membership Formal Group',
        joinRequiresApproval: false,
      });
      const result = (await setFormalGroup(
        EVENT_ATTENDEE_TOKEN,
        group.id,
      )) as FormalGroupResponseDto;
      expect(result.groupId).toBe(group.id);
      expect(result.endedOn).toBeNull();

      const affiliation = await app
        .get(EntityManager)
        .fork()
        .findOne(FormalGroupAffiliation, {
          user: localUserIdByToken.get(EVENT_ATTENDEE_TOKEN),
          endedOn: null,
        });
      expect(affiliation?.group.id).toBe(group.id);
    });

    it('accepts a section under a legacy nested child group, not just direct sections', async () => {
      const root = await createGroup({
        name: 'Nested Formal Group Root',
      });
      const child = await createGroup({
        name: 'Nested Formal Group Child',
      });
      // root and child are two independent fresh owners here - grant root's
      // owner ADMIN on child, then make them child's OWNER directly in the
      // DB (forceGroupOwnerForFixture) so a single actor can create the
      // nested Section below, same reasoning as hierarchy.e2e-spec.ts's
      // createGroupOwnedByA.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${child.id}/role-assignments`)
        .set('Authorization', `Bearer ${child.token}`)
        .send({ userId: root.userId, role: 'ADMIN' })
        .expect(201);
      // Directly in the DB - root's owner already owns a Group, which the
      // real transfer refuses (see forceGroupOwnerForFixture).
      await forceGroupOwnerForFixture(app, child.id, root.userId);

      await attachLegacyGroupParent(child.id, root.id);
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

    it("makes the creator's new Group their formal Group immediately - no extra join step", async () => {
      const group = await createGroup({ name: 'Owner Formal Group' });

      const profile = await getOwnProfile(group.token);
      expect(profile.formalGroup?.groupId).toBe(group.id);
    });

    it('refuses to let an OWNER end their formal membership (OWNER_MUST_STAY_IN_FORMAL_GROUP)', async () => {
      const group = await createGroup({ name: 'Owner Cannot Leave' });

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete('/api/v1/users/me/formal-group')
          .set('Authorization', `Bearer ${group.token}`)
          .expect(409),
      );
      expect((error as unknown as { code: string }).code).toBe(
        'OWNER_MUST_STAY_IN_FORMAL_GROUP',
      );
      const profile = await getOwnProfile(group.token);
      expect(profile.formalGroup?.groupId).toBe(group.id);
    });

    it('refuses to let an OWNER switch their formal Group to another Group', async () => {
      const owned = await createGroup({ name: 'Owner Cannot Switch' });
      const other = await createGroup({ name: 'Owner Switch Target' });
      const otherSection = await createSection(other.token, other.id, {
        name: 'Owner Switch Target Section',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${otherSection.id}/members`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ userId: owned.userId })
        .expect(201);

      const error = (await setFormalGroup(
        owned.token,
        other.id,
        undefined,
        409,
      )) as HttpErrorResponse;
      expect((error as unknown as { code: string }).code).toBe(
        'OWNER_MUST_STAY_IN_FORMAL_GROUP',
      );
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

  // ─── Group join requests (Group.joinRequiresApproval) ──────────────────
  // "Dołączanie publiczne" off: PUT /users/me/formal-group sends a join
  // request to the Group's OWNER/ADMIN instead of switching the formal
  // Group; only approval switches it (atomically, ending the old one).
  describe('PUT /users/me/formal-group - Group requiring approval', () => {
    // A brand-new plain user (no Group, no formal affiliation) per call -
    // the file's fixed tokens carry formal-Group state across tests.
    async function createFreshUser(
      prefix: string,
    ): Promise<{ token: string; userId: string }> {
      const suffix = `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
      const clerkUserId = `user_test_join_${suffix}`;
      const token = `valid-join-${suffix}-token`;
      TOKEN_TO_AUTH[token] = {
        userId: clerkUserId,
        sessionId: `sess_${suffix}`,
        tokenType: 'session_token',
        claims: { sub: clerkUserId, sid: `sess_${suffix}` },
      };
      FIXTURE_CLERK_PROFILES[clerkUserId] = {
        imageUrl: `https://img.clerk.com/${suffix}.png`,
        primaryEmailAddress: { emailAddress: `${suffix}@example.com` },
      };
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const user = await app
        .get(EntityManager)
        .fork()
        .findOneOrFail(User, { clerkUserId });
      return { token, userId: user.id };
    }

    async function requestFormalGroup(
      token: string,
      groupId: string,
    ): Promise<PendingFormalGroupRequestResponseDto> {
      return bodyOf<PendingFormalGroupRequestResponseDto>(
        request(app.getHttpServer())
          .put('/api/v1/users/me/formal-group')
          .set('Authorization', `Bearer ${token}`)
          .send({ groupId })
          .expect(202),
      );
    }

    async function getGroup(
      token: string,
      groupId: string,
    ): Promise<GroupResponseDto> {
      return bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${groupId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      );
    }

    async function listJoinRequests(
      token: string,
      groupId: string,
      expectStatus = 200,
    ): Promise<MembershipRequestResponseDto[]> {
      return bodyOf<MembershipRequestResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${groupId}/join-requests`)
          .set('Authorization', `Bearer ${token}`)
          .expect(expectStatus),
      );
    }

    async function decide(
      token: string,
      groupId: string,
      requestId: string,
      decision: 'approve' | 'reject',
      expectStatus = 204,
    ): Promise<void> {
      await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${groupId}/join-requests/${requestId}/${decision}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(expectStatus);
    }

    async function requestStatus(
      requestId: string,
    ): Promise<MembershipRequestStatus> {
      const row = await app
        .get(EntityManager)
        .fork()
        .findOneOrFail(MembershipRequest, { id: requestId });
      return row.status;
    }

    it('sends a request instead of switching, without needing a Section membership, and refuses a duplicate', async () => {
      const group = await createGroup({
        name: 'Approval Group Pending',
        joinRequiresApproval: true,
      });
      expect(group.joinRequiresApproval).toBe(true);
      const requester = await createFreshUser('pending');

      const { pendingRequest } = await requestFormalGroup(
        requester.token,
        group.id,
      );
      expect(pendingRequest.status).toBe(MembershipRequestStatus.PENDING);
      expect(pendingRequest.targetGroupId).toBe(group.id);

      expect((await getOwnProfile(requester.token)).formalGroup).toBeNull();
      expect(
        (await getGroup(requester.token, group.id)).hasPendingJoinRequest,
      ).toBe(true);

      const duplicate = (await setFormalGroup(
        requester.token,
        group.id,
        undefined,
        409,
      )) as HttpErrorResponse;
      expect((duplicate as unknown as { code: string }).code).toBe(
        'JOIN_REQUEST_ALREADY_PENDING',
      );

      const received = await app.get(EntityManager).fork().find(Notification, {
        contextGroup: group.id,
        type: NotificationType.GROUP_JOIN_REQUEST_RECEIVED,
      });
      expect(received.map((row) => row.recipient.id)).toContain(group.userId);
    });

    it('approval switches the formal Group atomically, ending the previous one, and notifies the requester', async () => {
      const previous = await createGroup({ name: 'Approval Previous Group' });
      const previousSection = await createSection(previous.token, previous.id, {
        name: 'Approval Previous Section',
      });
      const requester = await createFreshUser('approve');
      localUserIdByToken.set(requester.token, requester.userId);
      await joinSection(previous.token, previousSection.id, requester.token);
      await setFormalGroup(requester.token, previous.id);

      const group = await createGroup({
        name: 'Approval Group Approve',
        joinRequiresApproval: true,
      });
      const { pendingRequest } = await requestFormalGroup(
        requester.token,
        group.id,
      );

      const listed = await listJoinRequests(group.token, group.id);
      const row = listed.find((item) => item.id === pendingRequest.id);
      expect(row?.initiatedBy.id).toBe(requester.userId);
      expect(row?.initiatedBy).toHaveProperty('apelido');
      expect(row?.initiatedBy).toHaveProperty('image');

      // Still the previous one until approved.
      expect((await getOwnProfile(requester.token)).formalGroup?.groupId).toBe(
        previous.id,
      );

      await decide(group.token, group.id, pendingRequest.id, 'approve');

      expect(await requestStatus(pendingRequest.id)).toBe(
        MembershipRequestStatus.ACCEPTED,
      );
      expect((await getOwnProfile(requester.token)).formalGroup?.groupId).toBe(
        group.id,
      );
      const rows = await app
        .get(EntityManager)
        .fork()
        .find(FormalGroupAffiliation, { user: requester.userId });
      expect(
        rows.filter((affiliation) => affiliation.endedOn === null),
      ).toHaveLength(1);
      expect(
        rows.find((affiliation) => affiliation.group.id === previous.id)
          ?.endedOn,
      ).not.toBeNull();

      const approved = await app.get(EntityManager).fork().find(Notification, {
        recipient: requester.userId,
        type: NotificationType.GROUP_JOIN_REQUEST_APPROVED,
      });
      expect(approved).toHaveLength(1);
    });

    it('keeps the startedOn given with the request and applies exactly it on approval', async () => {
      const group = await createGroup({
        name: 'Approval Group StartedOn',
        joinRequiresApproval: true,
      });
      const requester = await createFreshUser('started-on');
      const { pendingRequest } =
        await bodyOf<PendingFormalGroupRequestResponseDto>(
          request(app.getHttpServer())
            .put('/api/v1/users/me/formal-group')
            .set('Authorization', `Bearer ${requester.token}`)
            .send({ groupId: group.id, startedOn: '2015-06-20' })
            .expect(202),
        );
      expect(pendingRequest.requestedStartedOn).toBe('2015-06-20');

      await decide(group.token, group.id, pendingRequest.id, 'approve');

      const profile = await getOwnProfile(requester.token);
      expect(profile.formalGroup?.groupId).toBe(group.id);
      expect(profile.formalGroup?.startedOn).toBe('2015-06-20');
    });

    it('rejection keeps the formal Group as it was and allows a new request later', async () => {
      const group = await createGroup({
        name: 'Approval Group Reject',
        joinRequiresApproval: true,
      });
      const requester = await createFreshUser('reject');
      const { pendingRequest } = await requestFormalGroup(
        requester.token,
        group.id,
      );

      await decide(group.token, group.id, pendingRequest.id, 'reject');

      expect(await requestStatus(pendingRequest.id)).toBe(
        MembershipRequestStatus.REJECTED,
      );
      expect((await getOwnProfile(requester.token)).formalGroup).toBeNull();
      expect(
        (await getGroup(requester.token, group.id)).hasPendingJoinRequest,
      ).toBe(false);

      const again = await requestFormalGroup(requester.token, group.id);
      expect(again.pendingRequest.id).not.toBe(pendingRequest.id);
    });

    it('lets the requester withdraw a pending request', async () => {
      const group = await createGroup({
        name: 'Approval Group Withdraw',
        joinRequiresApproval: true,
      });
      const requester = await createFreshUser('withdraw');
      const { pendingRequest } = await requestFormalGroup(
        requester.token,
        group.id,
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${group.id}/join-requests/mine`)
        .set('Authorization', `Bearer ${requester.token}`)
        .expect(204);

      expect(await requestStatus(pendingRequest.id)).toBe(
        MembershipRequestStatus.CANCELLED,
      );
      expect(
        (await getGroup(requester.token, group.id)).hasPendingJoinRequest,
      ).toBe(false);
    });

    it('a new request to another Group cancels the previous pending one', async () => {
      const groupA = await createGroup({
        name: 'Approval Group Switch A',
        joinRequiresApproval: true,
      });
      const groupB = await createGroup({
        name: 'Approval Group Switch B',
        joinRequiresApproval: true,
      });
      const requester = await createFreshUser('switch');
      const first = await requestFormalGroup(requester.token, groupA.id);
      await requestFormalGroup(requester.token, groupB.id);

      expect(await requestStatus(first.pendingRequest.id)).toBe(
        MembershipRequestStatus.CANCELLED,
      );
    });

    it("only the target Group's own reviewers may see or decide its requests", async () => {
      const group = await createGroup({
        name: 'Approval Group Scope',
        joinRequiresApproval: true,
      });
      const otherGroup = await createGroup({ name: 'Approval Other Group' });
      const requester = await createFreshUser('scope');
      const { pendingRequest } = await requestFormalGroup(
        requester.token,
        group.id,
      );

      // A plain user has no GROUP_JOIN_REQUEST_REVIEW on the Group.
      await listJoinRequests(requester.token, group.id, 404);
      // Another Group's OWNER can't reach it through their own Group's route.
      await decide(
        otherGroup.token,
        otherGroup.id,
        pendingRequest.id,
        'approve',
        404,
      );
      expect(await requestStatus(pendingRequest.id)).toBe(
        MembershipRequestStatus.PENDING,
      );
    });
  });
});
