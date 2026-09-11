/**
 * E2E tests for POST /trainings/:trainingId/check-in - the numericCode/QR
 * check-in entry point wired onto TrainingAttendanceService.record()
 * (module spec §11). Every existing rule (permission, cancelled/not-started
 * guard, roster eligibility, race-safe upsert) is reused as-is; this file
 * only covers the new identity-resolution + idempotency layer on top.
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
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { TrainingResponseDto } from '../src/trainings/dto/training-response.dto';
import { TrainingCheckInResultDto } from '../src/trainings/dto/training-attendance-response.dto';
import { Training } from '../src/trainings/entities/training.entity';
import { TrainingAttendance } from '../src/trainings/entities/training-attendance.entity';
import { TrainingRsvp } from '../src/trainings/entities/training-rsvp.entity';
import { TrainingVisibility } from '../src/trainings/enums/training-visibility.enum';

const CONFIGURED_WEB_BASE_URL = 'https://capohub.test';

const OWNER_TOKEN = 'valid-training-checkin-owner-token';
const ADMIN_TOKEN = 'valid-training-checkin-admin-token';
const INSTRUCTOR_TOKEN = 'valid-training-checkin-instructor-token';
const MEMBER_TOKEN = 'valid-training-checkin-member-token';
const OUTSIDER_TOKEN = 'valid-training-checkin-outsider-token';
const EXTERNAL_TRAINER_TOKEN = 'valid-training-checkin-external-trainer-token';
const EXTERNAL_RSVP_TOKEN = 'valid-training-checkin-external-rsvp-token';

const CLERK_IDS: Record<string, string> = {
  [OWNER_TOKEN]: 'user_test_trn_ci_owner',
  [ADMIN_TOKEN]: 'user_test_trn_ci_admin',
  [INSTRUCTOR_TOKEN]: 'user_test_trn_ci_instructor',
  [MEMBER_TOKEN]: 'user_test_trn_ci_member',
  [OUTSIDER_TOKEN]: 'user_test_trn_ci_outsider',
  [EXTERNAL_TRAINER_TOKEN]: 'user_test_trn_ci_ext_trainer',
  [EXTERNAL_RSVP_TOKEN]: 'user_test_trn_ci_ext_rsvp',
};

const TOKEN_TO_AUTH: Record<string, AuthContext> = Object.fromEntries(
  Object.entries(CLERK_IDS).map(([token, clerkUserId]) => [
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

const TEST_CLERK_USER_IDS = Object.values(CLERK_IDS);

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

describe('Training Check-In (e2e)', () => {
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
    // The "checks in by User QR payload" test below needs a real,
    // deterministic PUBLIC_WEB_BASE_URL to build a resolvable QR link
    // against, regardless of whatever the ambient .env does or doesn't
    // have configured - see qr-payload.util.ts.
    jest
      .spyOn(appConfig, 'publicWebBaseUrl', 'get')
      .mockReturnValue(CONFIGURED_WEB_BASE_URL);
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
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(TrainingAttendance, {
        training: { section: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(TrainingRsvp, {
        training: { section: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(Training, {
        section: { $in: createdGroupIds },
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
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function groupPayload(): Record<string, unknown> {
    return {
      name: 'Training Check-In Test Org',
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
    };
  }

  async function createGroup(token: string): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send(groupPayload())
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Training Check-In Test Section',
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
      city: 'Warsaw',
      region: 'Mazovia',
      geonameId: 756135,
      ...overrides,
    };
  }

  async function createSection(
    token: string,
    parentGroupId: string,
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload())
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function addSectionMember(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken) })
      .expect(201);
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

  /** OWNER (creator) + ADMIN + INSTRUCTOR + MEMBER, all active members. */
  async function createSectionWithRoles(): Promise<SectionResponseDto> {
    const group = await createGroup(OWNER_TOKEN);
    const section = await createSection(OWNER_TOKEN, group.id);
    await addSectionMember(OWNER_TOKEN, section.id, ADMIN_TOKEN);
    await grantSectionRole(
      OWNER_TOKEN,
      section.id,
      ADMIN_TOKEN,
      GroupRole.ADMIN,
    );
    await addSectionMember(OWNER_TOKEN, section.id, INSTRUCTOR_TOKEN);
    await grantSectionRole(
      OWNER_TOKEN,
      section.id,
      INSTRUCTOR_TOKEN,
      GroupRole.INSTRUCTOR,
    );
    await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
    return section;
  }

  /** A Training that already started, so attendance may be recorded. */
  async function createStartedTraining(
    token: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<TrainingResponseDto> {
    return bodyOf<TrainingResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/trainings`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          locationName: null,
          locationAddress: null,
          trainerUserId: localUserIdByToken.get(OWNER_TOKEN),
          description: null,
          visibility: TrainingVisibility.MEMBERS_ONLY,
          ...overrides,
        })
        .expect(201),
    );
  }

  async function getNumericCode(token: string): Promise<string> {
    const profile = await bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
    return profile.numericCode;
  }

  function checkIn(
    token: string,
    trainingId: string,
    identity: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/trainings/${trainingId}/check-in`)
      .set('Authorization', `Bearer ${token}`)
      .send({ identity });
  }

  it('lets the assigned trainer check in a member by numericCode', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id, {
      trainerUserId: localUserIdByToken.get(OWNER_TOKEN),
    });
    const code = await getNumericCode(MEMBER_TOKEN);

    const result = await bodyOf<TrainingCheckInResultDto>(
      checkIn(OWNER_TOKEN, training.id, code).expect(201),
    );
    expect(result.attended).toBe(true);
    expect(result.alreadyCheckedIn).toBe(false);
  });

  it.each([ADMIN_TOKEN, INSTRUCTOR_TOKEN])(
    'lets a Section %s check in a member',
    async (managerToken) => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(OWNER_TOKEN, section.id);
      const code = await getNumericCode(MEMBER_TOKEN);

      await checkIn(managerToken, training.id, code).expect(201);
    },
  );

  it('rejects an ordinary participant (plain MEMBER) trying to check someone in', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id);
    const code = await getNumericCode(ADMIN_TOKEN);

    const error = await bodyOf<HttpErrorResponse>(
      checkIn(MEMBER_TOKEN, training.id, code).expect(403),
    );
    expect(error.code).toBe('TRAINING_ATTENDANCE_FORBIDDEN');
  });

  it('rejects a total outsider trying to check someone in', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id);
    const code = await getNumericCode(MEMBER_TOKEN);

    await checkIn(OUTSIDER_TOKEN, training.id, code).expect(403);
  });

  it('accepts an external RSVP YES person for a PUBLIC training', async () => {
    const section = await createSectionWithRoles();
    // RSVP is blocked once a training has started (assertTrainingNotStarted
    // - see training-rsvp.service.ts), so this training is created with a
    // near-future startsAt, RSVP'd while still upcoming, then pushed into
    // the past directly (same nativeUpdate technique other e2e suites in
    // this repo already use to force a specific state) so check-in's own
    // "must have started" rule can be exercised afterwards.
    const training = await bodyOf<TrainingResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
          locationName: null,
          locationAddress: null,
          trainerUserId: localUserIdByToken.get(OWNER_TOKEN),
          description: null,
          visibility: TrainingVisibility.PUBLIC,
        })
        .expect(201),
    );
    await request(app.getHttpServer())
      .put(`/api/v1/trainings/${training.id}/rsvp`)
      .set('Authorization', `Bearer ${EXTERNAL_RSVP_TOKEN}`)
      .send({ status: 'YES' })
      .expect(200);

    const em = app.get(EntityManager).fork();
    await em.nativeUpdate(
      Training,
      { id: training.id },
      { startsAt: new Date(Date.now() - 30 * 60_000) },
    );

    const code = await getNumericCode(EXTERNAL_RSVP_TOKEN);
    const result = await bodyOf<TrainingCheckInResultDto>(
      checkIn(OWNER_TOKEN, training.id, code).expect(201),
    );
    expect(result.attended).toBe(true);
  });

  it('rejects a non-eligible user (no membership, no external RSVP)', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id, {
      visibility: TrainingVisibility.PUBLIC,
    });
    const code = await getNumericCode(EXTERNAL_TRAINER_TOKEN);

    const error = await bodyOf<HttpErrorResponse>(
      checkIn(OWNER_TOKEN, training.id, code).expect(400),
    );
    expect(error.code).toBe('TRAINING_ATTENDANCE_USER_NOT_ELIGIBLE');
  });

  it('rejects before the training has started', async () => {
    const section = await createSectionWithRoles();
    const training = await bodyOf<TrainingResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
          locationName: null,
          locationAddress: null,
          trainerUserId: localUserIdByToken.get(OWNER_TOKEN),
          description: null,
          visibility: TrainingVisibility.MEMBERS_ONLY,
        })
        .expect(201),
    );
    const code = await getNumericCode(MEMBER_TOKEN);

    const error = await bodyOf<HttpErrorResponse>(
      checkIn(OWNER_TOKEN, training.id, code).expect(409),
    );
    expect(error.code).toBe('TRAINING_NOT_STARTED');
  });

  it('is idempotent - a second identical scan changes nothing', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id);
    const code = await getNumericCode(MEMBER_TOKEN);

    const first = await bodyOf<TrainingCheckInResultDto>(
      checkIn(OWNER_TOKEN, training.id, code).expect(201),
    );
    expect(first.alreadyCheckedIn).toBe(false);

    const second = await bodyOf<TrainingCheckInResultDto>(
      checkIn(OWNER_TOKEN, training.id, code).expect(201),
    );
    expect(second.alreadyCheckedIn).toBe(true);
    expect(second.attended).toBe(true);
  });

  it('resolves a User QR payload the same way as a raw numeric code', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id);
    const code = await getNumericCode(MEMBER_TOKEN);

    const result = await bodyOf<TrainingCheckInResultDto>(
      checkIn(
        OWNER_TOKEN,
        training.id,
        `${CONFIGURED_WEB_BASE_URL}/u/${code}`,
      ).expect(201),
    );
    expect(result.attended).toBe(true);
  });

  it('rejects malformed identity with 400, never 500', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id);

    await checkIn(OWNER_TOKEN, training.id, 'garbage').expect(400);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const section = await createSectionWithRoles();
    const training = await createStartedTraining(OWNER_TOKEN, section.id);

    await request(app.getHttpServer())
      .post(`/api/v1/trainings/${training.id}/check-in`)
      .send({ identity: '123456' })
      .expect(401);
  });
});
