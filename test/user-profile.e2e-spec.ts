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
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { UserResponseDto } from '../src/users/dto/user-response.dto';
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { PublicUserProfileResponseDto } from '../src/users/dto/public-user-profile-response.dto';
import { FormalGroupResponseDto } from '../src/users/dto/formal-group-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { EventAttendeeResponseDto } from '../src/events/dto/event-attendee-response.dto';
import { EventGuardianAssignment } from '../src/events/entities/event-guardian-assignment.entity';
import { EventAttendee } from '../src/events/entities/event-attendee.entity';
import { EventInvitation } from '../src/events/entities/event-invitation.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventRole } from '../src/events/enums/event-role.enum';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';

const ADMIN_TOKEN = 'valid-profile-admin-token';
const TARGET_TOKEN = 'valid-profile-target-token';
const VIEWER_TOKEN = 'valid-profile-viewer-token';
const SECTION_ADMIN_TOKEN = 'valid-profile-section-admin-token';
const OTHER_ADMIN_TOKEN = 'valid-profile-other-admin-token';
const EVENT_ORGANIZER_TOKEN = 'valid-profile-event-organizer-token';
const EVENT_MODERATOR_TOKEN = 'valid-profile-event-moderator-token';
const EVENT_ATTENDEE_TOKEN = 'valid-profile-event-attendee-token';

const TOKENS = [
  ADMIN_TOKEN,
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

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

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
      // Any remaining formal affiliation (target Group not in
      // createdGroupIds' delete order edge cases) cascades from the User
      // delete below (user_id is `on delete cascade`).
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
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
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
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

  function eventPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: 'WORKSHOP',
      customTypeLabel: null,
      name: 'Roda de Teste',
      description: 'A profile-visibility test event',
      coverImageUrl: null,
      startsAt: '2027-01-10T10:00:00.000Z',
      endsAt: '2027-01-10T18:00:00.000Z',
      locationName: 'Main hall',
      locationAddress: null,
      latitude: null,
      longitude: null,
      visibility: EventVisibility.COMMUNITY_MEMBERS,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  async function createEvent(
    token: string,
    groupId: string,
  ): Promise<EventResponseDto> {
    return bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send(eventPayload())
        .expect(201),
    );
  }

  async function publishEvent(token: string, eventId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  async function grantEventRole(
    ownerToken: string,
    eventId: string,
    memberToken: string,
    role: EventRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/roles`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function registerForEvent(
    token: string,
    eventId: string,
  ): Promise<EventAttendeeResponseDto[]> {
    return bodyOf<EventAttendeeResponseDto[]>(
      request(app.getHttpServer())
        .post(`/api/v1/events/${eventId}/register`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attendSelf: true, children: [] })
        .expect(201),
    );
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
        city: 'Recife',
        country: 'br',
        capoeiraStartedAt: '2015-05-20',
      })) as UserProfileResponseDto;
      expect(complete.profileComplete).toBe(true);
      expect(complete.lastName).toBe('Lovelace');
      expect(complete.apelido).toBe('Formiga');
      expect(complete.city).toBe('Recife');
      // Normalized to uppercase, per UpdateUserProfileDto.
      expect(complete.country).toBe('BR');
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

    it('never exposes email/phone/account fields on the own-profile DTO', async () => {
      const profile = await getOwnProfile(VIEWER_TOKEN);
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('phone');
      expect(profile).not.toHaveProperty('clerkUserId');
    });
  });

  // ─── Public profile visibility ──────────────────────────────────────────

  describe('GET /users/:userId/profile - name/apelido/location visibility', () => {
    it('shows apelido instead of the hidden full name, then falls back to publicCode when apelido is also hidden', async () => {
      await patchOwnProfile(TARGET_TOKEN, {
        firstName: 'Camila',
        lastName: 'Silva',
        apelido: 'Cobrinha',
        showFullName: false,
        showApelido: true,
      });
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;

      const withApelido = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(withApelido.displayName).toBe('Cobrinha');
      expect(withApelido.apelido).toBe('Cobrinha');
      expect(withApelido.firstName).toBeNull();
      expect(withApelido.lastName).toBeNull();

      await patchOwnProfile(TARGET_TOKEN, { showApelido: false });
      const withoutApelido = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(withoutApelido.apelido).toBeNull();

      const own = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${TARGET_TOKEN}`)
          .expect(200),
      );
      expect(withoutApelido.displayName).toBe(own.publicCode);
      // Never the pre-existing account displayName, even though it could
      // already contain a real name.
      expect(withoutApelido.displayName).not.toBe(own.displayName);
    });

    it('shows the full name once showFullName is enabled', async () => {
      await patchOwnProfile(TARGET_TOKEN, { showFullName: true });
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;

      const visible = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(visible.displayName).toBe('Camila Silva');
      expect(visible.firstName).toBe('Camila');
      expect(visible.lastName).toBe('Silva');

      // Reset for later tests in this file that rely on showFullName=false.
      await patchOwnProfile(TARGET_TOKEN, { showFullName: false });
    });

    it('gates city/country together behind showLocation, independent of showFullName', async () => {
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      await patchOwnProfile(TARGET_TOKEN, { city: 'Recife', country: 'BR' });

      const hidden = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(hidden.city).toBeNull();
      expect(hidden.country).toBeNull();

      await patchOwnProfile(TARGET_TOKEN, { showLocation: true });
      const visible = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(visible.city).toBe('Recife');
      expect(visible.country).toBe('BR');

      await patchOwnProfile(TARGET_TOKEN, { showLocation: false });
    });

    it('never leaks email, phone, or account fields on the public DTO', async () => {
      const targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      const profile = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('phone');
      expect(profile).not.toHaveProperty('clerkUserId');
    });
  });

  describe('GET /users/:userId/profile - exact-Section admin access to full name', () => {
    let group: GroupResponseDto;
    let section: SectionResponseDto;
    let otherGroup: GroupResponseDto;
    let otherSection: SectionResponseDto;
    let targetId: string;

    beforeAll(async () => {
      group = await createGroup(ADMIN_TOKEN, {
        name: 'Full Name Access Group',
      });
      section = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Full Name Access Section',
      });
      otherGroup = await createGroup(ADMIN_TOKEN, {
        name: 'Unrelated Group',
      });
      otherSection = await createSection(ADMIN_TOKEN, otherGroup.id, {
        name: 'Unrelated Section',
      });

      targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      await patchOwnProfile(TARGET_TOKEN, {
        firstName: 'Camila',
        lastName: 'Silva',
        showFullName: false,
      });

      await joinSection(ADMIN_TOKEN, section.id, TARGET_TOKEN);
      await joinSection(ADMIN_TOKEN, section.id, SECTION_ADMIN_TOKEN);
      await grantSectionRole(
        ADMIN_TOKEN,
        section.id,
        SECTION_ADMIN_TOKEN,
        GroupRole.ADMIN,
      );

      await joinSection(ADMIN_TOKEN, otherSection.id, OTHER_ADMIN_TOKEN);
      await grantSectionRole(
        ADMIN_TOKEN,
        otherSection.id,
        OTHER_ADMIN_TOKEN,
        GroupRole.ADMIN,
      );
    });

    it('lets OWNER/ADMIN of the exact section (with their own active membership) see the full name', async () => {
      const profile = await getPublicProfile(SECTION_ADMIN_TOKEN, targetId);
      expect(profile.firstName).toBe('Camila');
      expect(profile.lastName).toBe('Silva');
      expect(profile.displayName).toBe('Camila Silva');
    });

    it('does not let an admin of a different section see the full name', async () => {
      const profile = await getPublicProfile(OTHER_ADMIN_TOKEN, targetId);
      expect(profile.firstName).toBeNull();
      expect(profile.lastName).toBeNull();
    });

    it('does not let an ordinary viewer with no relationship see the full name', async () => {
      const profile = await getPublicProfile(VIEWER_TOKEN, targetId);
      expect(profile.firstName).toBeNull();
      expect(profile.lastName).toBeNull();
    });
  });

  describe('GET /users/:userId/profile - Event organizer access to full name', () => {
    let group: GroupResponseDto;
    let event: EventResponseDto;
    let targetId: string;

    beforeAll(async () => {
      group = await createGroup(ADMIN_TOKEN, {
        name: 'Event Access Group',
      });
      // Group-level ADMIN is this codebase's stand-in for "community
      // member" at the Group level (Group has no membership at all - see
      // RoleAssignmentsService.isCommunityMember) - sufficient for
      // COMMUNITY_MEMBERS event visibility/registration.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/role-assignments`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({
          userId: localUserIdByToken.get(TARGET_TOKEN),
          role: GroupRole.ADMIN,
        })
        .expect(201);
      for (const token of [
        EVENT_ORGANIZER_TOKEN,
        EVENT_MODERATOR_TOKEN,
        EVENT_ATTENDEE_TOKEN,
      ]) {
        await request(app.getHttpServer())
          .post(`/api/v1/groups/${group.id}/role-assignments`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({
            userId: localUserIdByToken.get(token),
            role: GroupRole.ADMIN,
          })
          .expect(201);
      }

      event = await createEvent(ADMIN_TOKEN, group.id);
      await publishEvent(ADMIN_TOKEN, event.id);
      await grantEventRole(
        ADMIN_TOKEN,
        event.id,
        EVENT_ORGANIZER_TOKEN,
        EventRole.ORGANIZER,
      );
      await grantEventRole(
        ADMIN_TOKEN,
        event.id,
        EVENT_MODERATOR_TOKEN,
        EventRole.MODERATOR,
      );

      targetId = localUserIdByToken.get(TARGET_TOKEN) as string;
      await patchOwnProfile(TARGET_TOKEN, {
        firstName: 'Camila',
        lastName: 'Silva',
        showFullName: false,
      });
      await registerForEvent(TARGET_TOKEN, event.id);
      await registerForEvent(EVENT_ATTENDEE_TOKEN, event.id);
    });

    it('lets the Event OWNER/ORGANIZER see the full name of an attending participant', async () => {
      const profile = await getPublicProfile(EVENT_ORGANIZER_TOKEN, targetId);
      expect(profile.firstName).toBe('Camila');
      expect(profile.lastName).toBe('Silva');
    });

    it('does not let a MODERATOR see the full name', async () => {
      const profile = await getPublicProfile(EVENT_MODERATOR_TOKEN, targetId);
      expect(profile.firstName).toBeNull();
      expect(profile.lastName).toBeNull();
    });

    it('does not let a plain attendee see the full name', async () => {
      const profile = await getPublicProfile(EVENT_ATTENDEE_TOKEN, targetId);
      expect(profile.firstName).toBeNull();
      expect(profile.lastName).toBeNull();
    });
  });

  // ─── sections list ───────────────────────────────────────────────────────

  describe('GET /users/:userId/profile - sections list', () => {
    it('shows only id/name for active-membership sections, never roles or membership status, gated by showSections', async () => {
      const group = await createGroup(ADMIN_TOKEN, {
        name: 'Sections List Group',
      });
      const sectionA = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Sections List Section A',
      });
      const sectionB = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Sections List Section B',
      });
      await joinSection(ADMIN_TOKEN, sectionA.id, VIEWER_TOKEN);
      await joinSection(ADMIN_TOKEN, sectionB.id, VIEWER_TOKEN);
      await grantSectionRole(
        ADMIN_TOKEN,
        sectionA.id,
        VIEWER_TOKEN,
        GroupRole.ADMIN,
      );

      const targetId = localUserIdByToken.get(VIEWER_TOKEN) as string;

      const hidden = await getPublicProfile(OTHER_ADMIN_TOKEN, targetId);
      expect(hidden.sections).toBeNull();

      await patchOwnProfile(VIEWER_TOKEN, { showSections: true });
      const visible = await getPublicProfile(OTHER_ADMIN_TOKEN, targetId);
      expect(visible.sections).toHaveLength(2);
      const names = visible.sections?.map((s) => s.name).sort();
      expect(names).toEqual(
        ['Sections List Section A', 'Sections List Section B'].sort(),
      );
      for (const ref of visible.sections ?? []) {
        expect(Object.keys(ref).sort()).toEqual(['id', 'name']);
      }

      await patchOwnProfile(VIEWER_TOKEN, { showSections: false });
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

    it('GET /users/:userId/profile never returns a privacy-gated field regardless of who asks', async () => {
      const targetId = localUserIdByToken.get(SECTION_ADMIN_TOKEN) as string;
      // SECTION_ADMIN_TOKEN's profile was completed earlier in this file
      // with showFullName left at its default (false).
      const profile = await getPublicProfile(EVENT_ATTENDEE_TOKEN, targetId);
      expect(profile.firstName).toBeNull();
      expect(profile.lastName).toBeNull();
    });
  });

  // ─── Formal Group ────────────────────────────────────────────────────────

  describe('PUT/DELETE /users/me/formal-group', () => {
    it('rejects setting a formal group with no active section membership anywhere in its hierarchy', async () => {
      const group = await createGroup(ADMIN_TOKEN, {
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
      const root = await createGroup(ADMIN_TOKEN, {
        name: 'Nested Formal Group Root',
      });
      const child = await createGroup(ADMIN_TOKEN, {
        name: 'Nested Formal Group Child',
      });
      await attachGroupParent(ADMIN_TOKEN, child.id, root.id);
      const nestedSection = await createSection(ADMIN_TOKEN, child.id, {
        name: 'Nested Formal Group Section',
      });
      await joinSection(ADMIN_TOKEN, nestedSection.id, EVENT_ORGANIZER_TOKEN);

      const result = (await setFormalGroup(
        EVENT_ORGANIZER_TOKEN,
        root.id,
      )) as FormalGroupResponseDto;
      expect(result.groupId).toBe(root.id);
      expect(result.name).toBe('Nested Formal Group Root');
    });

    it('supports many SectionMemberships under a single formal Group, and switches atomically between two formal Groups', async () => {
      const groupA = await createGroup(ADMIN_TOKEN, { name: 'Formal Group A' });
      const sectionA1 = await createSection(ADMIN_TOKEN, groupA.id, {
        name: 'Formal Group A Section 1',
      });
      const sectionA2 = await createSection(ADMIN_TOKEN, groupA.id, {
        name: 'Formal Group A Section 2',
      });
      const groupB = await createGroup(ADMIN_TOKEN, { name: 'Formal Group B' });
      const sectionB = await createSection(ADMIN_TOKEN, groupB.id, {
        name: 'Formal Group B Section',
      });

      await joinSection(ADMIN_TOKEN, sectionA1.id, EVENT_MODERATOR_TOKEN);
      await joinSection(ADMIN_TOKEN, sectionA2.id, EVENT_MODERATOR_TOKEN);
      await joinSection(ADMIN_TOKEN, sectionB.id, EVENT_MODERATOR_TOKEN);

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
      const group = await createGroup(ADMIN_TOKEN, {
        name: 'Future Started On Group',
      });
      const section = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Future Started On Section',
      });
      await joinSection(ADMIN_TOKEN, section.id, OTHER_ADMIN_TOKEN);

      const error = (await setFormalGroup(
        OTHER_ADMIN_TOKEN,
        group.id,
        '2099-01-01',
        400,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(400);
    });

    it('rejects an archived group as a formal group', async () => {
      const group = await createGroup(ADMIN_TOKEN, {
        name: 'Archived Formal Group',
      });
      const section = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Archived Formal Group Section',
      });
      await joinSection(ADMIN_TOKEN, section.id, VIEWER_TOKEN);
      await archiveGroup(ADMIN_TOKEN, group.id);

      const error = (await setFormalGroup(
        VIEWER_TOKEN,
        group.id,
        undefined,
        409,
      )) as HttpErrorResponse;
      expect(error.statusCode).toBe(409);
    });

    it('rejects when the only qualifying membership is in an archived section, but accepts once an active section also qualifies', async () => {
      const group = await createGroup(ADMIN_TOKEN, {
        name: 'Archived Section Formal Group',
      });
      const archivedSection = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Archived Formal Section',
      });
      const activeSection = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Active Formal Section',
      });
      await joinSection(ADMIN_TOKEN, archivedSection.id, EVENT_ATTENDEE_TOKEN);
      await archiveSection(ADMIN_TOKEN, archivedSection.id);

      const stillRejected = (await setFormalGroup(
        EVENT_ATTENDEE_TOKEN,
        group.id,
        undefined,
        409,
      )) as HttpErrorResponse;
      expect(stillRejected.statusCode).toBe(409);

      await joinSection(ADMIN_TOKEN, activeSection.id, EVENT_ATTENDEE_TOKEN);
      const accepted = (await setFormalGroup(
        EVENT_ATTENDEE_TOKEN,
        group.id,
      )) as FormalGroupResponseDto;
      expect(accepted.groupId).toBe(group.id);
    });

    it('DELETE ends the active affiliation, and repeating it 404s', async () => {
      const group = await createGroup(ADMIN_TOKEN, {
        name: 'End Formal Group',
      });
      const section = await createSection(ADMIN_TOKEN, group.id, {
        name: 'End Formal Group Section',
      });
      await joinSection(ADMIN_TOKEN, section.id, SECTION_ADMIN_TOKEN);
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
      const group = await createGroup(ADMIN_TOKEN, {
        name: 'Leave Does Not End Formal Group',
      });
      const section = await createSection(ADMIN_TOKEN, group.id, {
        name: 'Leave Does Not End Formal Group Section',
      });
      await joinSection(ADMIN_TOKEN, section.id, OTHER_ADMIN_TOKEN);
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
