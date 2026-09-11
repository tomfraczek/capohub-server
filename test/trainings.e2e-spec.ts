/**
 * E2E tests for the Trainings module: one-off/recurring creation, series
 * generation, scoped edits (THIS / THIS_AND_FOLLOWING / ALL), cancellation,
 * RSVP, visibility, permissions and cross-Section IDOR.
 *
 * training-attendance.e2e-spec.ts covers attendance recording and
 * plan/notes access separately.
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
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { TrainingResponseDto } from '../src/trainings/dto/training-response.dto';
import { TrainingSeriesResponseDto } from '../src/trainings/dto/training-series-response.dto';
import { TrainingRsvpResponseDto } from '../src/trainings/dto/training-rsvp-response.dto';
import { Training } from '../src/trainings/entities/training.entity';
import { TrainingAttendance } from '../src/trainings/entities/training-attendance.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { TrainingRsvp } from '../src/trainings/entities/training-rsvp.entity';
import { TrainingSeries } from '../src/trainings/entities/training-series.entity';
import { TrainingStatus } from '../src/trainings/enums/training-status.enum';
import { TrainingVisibility } from '../src/trainings/enums/training-visibility.enum';

const OWNER_TOKEN = 'valid-trainings-owner-token';
const ADMIN_TOKEN = 'valid-trainings-admin-token';
const INSTRUCTOR_TOKEN = 'valid-trainings-instructor-token';
const ASSISTANT_TOKEN = 'valid-trainings-assistant-token';
const MEMBER_TOKEN = 'valid-trainings-member-token';
const OUTSIDER_TOKEN = 'valid-trainings-outsider-token';
const EXTERNAL_TRAINER_TOKEN = 'valid-trainings-external-trainer-token';

const OWNER_CLERK_ID = 'user_test_trainings_owner';
const ADMIN_CLERK_ID = 'user_test_trainings_admin';
const INSTRUCTOR_CLERK_ID = 'user_test_trainings_instructor';
const ASSISTANT_CLERK_ID = 'user_test_trainings_assistant';
const MEMBER_CLERK_ID = 'user_test_trainings_member';
const OUTSIDER_CLERK_ID = 'user_test_trainings_outsider';
const EXTERNAL_TRAINER_CLERK_ID = 'user_test_trainings_external_trainer';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_trainings_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_trainings_owner' },
  },
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_trainings_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_trainings_admin' },
  },
  [INSTRUCTOR_TOKEN]: {
    userId: INSTRUCTOR_CLERK_ID,
    sessionId: 'sess_trainings_instructor',
    tokenType: 'session_token',
    claims: { sub: INSTRUCTOR_CLERK_ID, sid: 'sess_trainings_instructor' },
  },
  [ASSISTANT_TOKEN]: {
    userId: ASSISTANT_CLERK_ID,
    sessionId: 'sess_trainings_assistant',
    tokenType: 'session_token',
    claims: { sub: ASSISTANT_CLERK_ID, sid: 'sess_trainings_assistant' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_trainings_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_trainings_member' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_trainings_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_trainings_outsider' },
  },
  [EXTERNAL_TRAINER_TOKEN]: {
    userId: EXTERNAL_TRAINER_CLERK_ID,
    sessionId: 'sess_trainings_external_trainer',
    tokenType: 'session_token',
    claims: {
      sub: EXTERNAL_TRAINER_CLERK_ID,
      sid: 'sess_trainings_external_trainer',
    },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = Object.fromEntries(
  Object.keys(TOKEN_TO_AUTH).map((token) => {
    const clerkId = TOKEN_TO_AUTH[token].userId;
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

describe('Trainings (e2e)', () => {
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
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(Notification, {
        contextSection: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(TrainingAttendance, {
        training: { section: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(TrainingRsvp, {
        training: { section: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(Training, {
        section: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(TrainingSeries, {
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
      name: 'Trainings Test Org',
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

  async function createGroup(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...groupPayload(), ...overrides })
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Trainings Test Section',
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
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function addSectionMember(
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

  /**
   * OWNER (creator) + ADMIN + INSTRUCTOR + ASSISTANT + MEMBER, all active
   * members of one fresh Section - the standard fixture for permission
   * matrix tests below.
   */
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
    await addSectionMember(OWNER_TOKEN, section.id, ASSISTANT_TOKEN);
    await grantSectionRole(
      OWNER_TOKEN,
      section.id,
      ASSISTANT_TOKEN,
      GroupRole.ASSISTANT,
    );
    await addSectionMember(OWNER_TOKEN, section.id, MEMBER_TOKEN);
    return section;
  }

  function trainingPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      startsAt: '2031-06-02T18:00:00.000Z',
      endsAt: '2031-06-02T20:00:00.000Z',
      locationName: 'Dojo',
      locationAddress: null,
      trainerUserId: localUserIdByToken.get(OWNER_TOKEN),
      description: 'Regular training',
      visibility: TrainingVisibility.MEMBERS_ONLY,
      ...overrides,
    };
  }

  async function createTraining(
    token: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<TrainingResponseDto> {
    return bodyOf<TrainingResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/trainings`)
        .set('Authorization', `Bearer ${token}`)
        .send(trainingPayload(overrides))
        .expect(201),
    );
  }

  function seriesPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      dayOfWeek: 3, // Wednesday
      startTime: '18:00',
      durationMinutes: 90,
      locationName: 'Dojo',
      locationAddress: null,
      defaultTrainerUserId: localUserIdByToken.get(OWNER_TOKEN),
      defaultDescription: 'Weekly training',
      visibility: TrainingVisibility.MEMBERS_ONLY,
      startDate: '2031-07-01', // a Tuesday
      endDate: '2031-07-31',
      ...overrides,
    };
  }

  async function createSeries(
    token: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<TrainingSeriesResponseDto> {
    return bodyOf<TrainingSeriesResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/sections/${sectionId}/training-series`)
        .set('Authorization', `Bearer ${token}`)
        .send(seriesPayload(overrides))
        .expect(201),
    );
  }

  // ─── CREATE: one-off ────────────────────────────────────────────────────

  describe('create one-off Training', () => {
    it('OWNER can create a one-off training', async () => {
      const section = await createSectionWithRoles();

      const training = await createTraining(OWNER_TOKEN, section.id);

      expect(training.seriesId).toBeNull();
      expect(training.status).toBe('SCHEDULED');
      expect(training.section.id).toBe(section.id);
    });

    it('INSTRUCTOR can create a training', async () => {
      const section = await createSectionWithRoles();

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings`)
        .set('Authorization', `Bearer ${INSTRUCTOR_TOKEN}`)
        .send(trainingPayload())
        .expect(201);
    });

    it('MEMBER cannot create a training', async () => {
      const section = await createSectionWithRoles();

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/trainings`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send(trainingPayload())
          .expect(403),
      );
      expect(error.code).toBe('INSUFFICIENT_GROUP_PERMISSIONS');
    });

    it('ASSISTANT cannot create a training', async () => {
      const section = await createSectionWithRoles();

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings`)
        .set('Authorization', `Bearer ${ASSISTANT_TOKEN}`)
        .send(trainingPayload())
        .expect(403);
    });

    it('rejects endsAt before startsAt', async () => {
      const section = await createSectionWithRoles();

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(
          trainingPayload({
            startsAt: '2031-06-02T20:00:00.000Z',
            endsAt: '2031-06-02T18:00:00.000Z',
          }),
        )
        .expect(400);
    });

    it('an external (non-member) trainer may be assigned', async () => {
      const section = await createSectionWithRoles();

      const training = await createTraining(OWNER_TOKEN, section.id, {
        trainerUserId: localUserIdByToken.get(EXTERNAL_TRAINER_TOKEN),
      });

      expect(training.trainer?.id).toBe(
        localUserIdByToken.get(EXTERNAL_TRAINER_TOKEN),
      );
    });

    // Module: "prowadzący opcjonalny, jeśli nie zaznaczony to nie pokazuje
    // w szczegółach treningu kto prowadzi, a nie że ja prowadzę" - omitting
    // trainerUserId entirely leaves the Training with no trainer, never
    // silently defaulted to the creator.
    it('creates a training with no trainer when trainerUserId is omitted', async () => {
      const section = await createSectionWithRoles();

      const training = await createTraining(OWNER_TOKEN, section.id, {
        trainerUserId: undefined,
      });

      expect(training.trainer).toBeNull();
    });
  });

  // ─── CREATE: recurring series ───────────────────────────────────────────

  describe('create TrainingSeries (recurring)', () => {
    it('generates one Training per matching weekday, all real database rows', async () => {
      const section = await createSectionWithRoles();

      // Wednesdays in July 2031: 2, 9, 16, 23, 30 = 5 occurrences.
      const series = await createSeries(OWNER_TOKEN, section.id);

      expect(series.generatedTrainingsCount).toBe(5);

      const list = await bodyOf<{
        items: TrainingResponseDto[];
        total: number;
      }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings?limit=100`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const seriesTrainings = list.items.filter(
        (t) => t.seriesId === series.id,
      );
      expect(seriesTrainings).toHaveLength(5);
      for (const training of seriesTrainings) {
        expect(new Date(training.startsAt).getUTCDay()).toBe(3);
      }
    });

    // Module: "prowadzący opcjonalny, jeśli nie zaznaczony to nie pokazuje
    // w szczegółach treningu kto prowadzi" - same as the one-off Training's
    // own test, but also verifies every generated occurrence inherits the
    // series' own trainer-less default.
    it('creates a series with no default trainer when defaultTrainerUserId is omitted, and every generated Training has none either', async () => {
      const section = await createSectionWithRoles();

      const series = await createSeries(OWNER_TOKEN, section.id, {
        defaultTrainerUserId: undefined,
      });

      expect(series.defaultTrainer).toBeNull();

      const list = await bodyOf<{ items: TrainingResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings?limit=100`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const seriesTrainings = list.items.filter(
        (t) => t.seriesId === series.id,
      );
      expect(seriesTrainings.length).toBeGreaterThan(0);
      for (const training of seriesTrainings) {
        expect(training.trainer).toBeNull();
      }
    });

    it('endDate more than 3 years after startDate is rejected', async () => {
      const section = await createSectionWithRoles();

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/training-series`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(seriesPayload({ startDate: '2031-01-01', endDate: '2034-06-01' }))
        .expect(400);
    });

    it('a custom endDate within 3 years is accepted', async () => {
      const section = await createSectionWithRoles();

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/training-series`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send(seriesPayload({ startDate: '2031-01-01', endDate: '2033-12-31' }))
        .expect(201);
    });

    it('MEMBER cannot create a series', async () => {
      const section = await createSectionWithRoles();

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/training-series`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send(seriesPayload())
        .expect(403);
    });
  });

  // ─── SERIES: scoped edits ───────────────────────────────────────────────

  describe('scoped edits (THIS / THIS_AND_FOLLOWING / ALL)', () => {
    it('THIS only changes the addressed Training, leaving its series siblings untouched', async () => {
      const section = await createSectionWithRoles();
      const series = await createSeries(OWNER_TOKEN, section.id);
      const list = await bodyOf<{ items: TrainingResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings?limit=100`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const seriesTrainings = list.items
        .filter((t) => t.seriesId === series.id)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const [first, second] = seriesTrainings;

      const updated = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/sections/${section.id}/trainings/${first.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ scope: 'THIS', locationName: 'Special venue' })
          .expect(200),
      );
      expect(updated.locationName).toBe('Special venue');

      const untouched = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings/${second.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(untouched.locationName).toBe('Dojo');
    });

    it('THIS_AND_FOLLOWING changes the anchor and every later occurrence, never earlier ones', async () => {
      const section = await createSectionWithRoles();
      const series = await createSeries(OWNER_TOKEN, section.id);
      const list = await bodyOf<{ items: TrainingResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings?limit=100`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const seriesTrainings = list.items
        .filter((t) => t.seriesId === series.id)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const [first, second, third] = seriesTrainings;

      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/trainings/${second.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ scope: 'THIS_AND_FOLLOWING', locationName: 'New venue' })
        .expect(200);

      const [firstAfter, secondAfter, thirdAfter] = await Promise.all(
        [first, second, third].map((t) =>
          bodyOf<TrainingResponseDto>(
            request(app.getHttpServer())
              .get(`/api/v1/sections/${section.id}/trainings/${t.id}`)
              .set('Authorization', `Bearer ${OWNER_TOKEN}`)
              .expect(200),
          ),
        ),
      );
      expect(firstAfter.locationName).toBe('Dojo');
      expect(secondAfter.locationName).toBe('New venue');
      expect(thirdAfter.locationName).toBe('New venue');
    });

    it('ALL (series PATCH) changes the recurrence day and regenerates future occurrences, leaving the past Training untouched', async () => {
      const section = await createSectionWithRoles();
      // startDate in the past relative to "now" so the first occurrence is
      // already historical; endDate reaches into the future.
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 21);
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 21);
      const series = await createSeries(OWNER_TOKEN, section.id, {
        dayOfWeek: past.getUTCDay(),
        startDate: past.toISOString().slice(0, 10),
        endDate: future.toISOString().slice(0, 10),
      });

      const before = await bodyOf<{ items: TrainingResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings?limit=100`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const seriesTrainingsBefore = before.items.filter(
        (t) => t.seriesId === series.id,
      );
      const historicalTraining = seriesTrainingsBefore
        .filter((t) => new Date(t.startsAt).getTime() < Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      expect(historicalTraining).toBeDefined();

      const newDayOfWeek = (past.getUTCDay() + 2) % 7;
      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/training-series/${series.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ dayOfWeek: newDayOfWeek })
        .expect(200);

      const historicalAfter = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .get(
            `/api/v1/sections/${section.id}/trainings/${historicalTraining.id}`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(historicalAfter.startsAt).toBe(historicalTraining.startsAt);

      const after = await bodyOf<{ items: TrainingResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings?limit=100`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const futureSeriesTrainings = after.items.filter(
        (t) =>
          t.seriesId === series.id &&
          new Date(t.startsAt).getTime() > Date.now() &&
          t.status === TrainingStatus.SCHEDULED,
      );
      expect(futureSeriesTrainings.length).toBeGreaterThan(0);
      for (const training of futureSeriesTrainings) {
        expect(new Date(training.startsAt).getUTCDay()).toBe(newDayOfWeek);
      }
    });
  });

  // ─── CANCEL ──────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('scope THIS cancels only the addressed Training and preserves its RSVPs', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        startsAt: '2031-06-10T18:00:00.000Z',
        endsAt: '2031-06-10T20:00:00.000Z',
      });
      await request(app.getHttpServer())
        .put(`/api/v1/trainings/${training.id}/rsvp`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ status: 'YES' })
        .expect(200);

      const cancelled = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .post(
            `/api/v1/sections/${section.id}/trainings/${training.id}/cancel`,
          )
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({ scope: 'THIS', reason: 'Holiday' })
          .expect(201),
      );
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.rsvpCounts.yes).toBe(1);
    });

    it('scope THIS_AND_FOLLOWING cancels this and later occurrences, leaving earlier ones scheduled', async () => {
      const section = await createSectionWithRoles();
      const series = await createSeries(OWNER_TOKEN, section.id);
      const list = await bodyOf<{ items: TrainingResponseDto[] }>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings?limit=100`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const seriesTrainings = list.items
        .filter((t) => t.seriesId === series.id)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const [first, second] = seriesTrainings;

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings/${second.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ scope: 'THIS_AND_FOLLOWING', reason: null })
        .expect(201);

      const firstAfter = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings/${first.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const secondAfter = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings/${second.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(firstAfter.status).toBe('SCHEDULED');
      expect(secondAfter.status).toBe('CANCELLED');
    });

    it('RSVP is rejected once a Training is cancelled', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        startsAt: '2031-06-11T18:00:00.000Z',
        endsAt: '2031-06-11T20:00:00.000Z',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings/${training.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ scope: 'THIS', reason: null })
        .expect(201);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/trainings/${training.id}/rsvp`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ status: 'YES' })
          .expect(409),
      );
      expect(error.code).toBe('TRAINING_CANCELLED');
    });
  });

  // ─── VISIBILITY ──────────────────────────────────────────────────────────

  describe('visibility', () => {
    it('a MEMBERS_ONLY training is invisible to an outsider', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.MEMBERS_ONLY,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/trainings/${training.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });

    it('a PUBLIC training is visible to an outsider', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.PUBLIC,
      });

      const seen = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings/${training.id}`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(200),
      );
      expect(seen.id).toBe(training.id);
    });
  });

  // ─── RSVP ────────────────────────────────────────────────────────────────

  describe('RSVP', () => {
    it('a member can set, change and delete their RSVP', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        startsAt: '2031-06-12T18:00:00.000Z',
        endsAt: '2031-06-12T20:00:00.000Z',
      });

      const yes = await bodyOf<TrainingRsvpResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/trainings/${training.id}/rsvp`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ status: 'YES' })
          .expect(200),
      );
      expect(yes.status).toBe('YES');

      const maybe = await bodyOf<TrainingRsvpResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/trainings/${training.id}/rsvp`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ status: 'MAYBE' })
          .expect(200),
      );
      expect(maybe.status).toBe('MAYBE');
      expect(maybe.id).toBe(yes.id);

      await request(app.getHttpServer())
        .delete(`/api/v1/trainings/${training.id}/rsvp`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const rsvps = await bodyOf<TrainingRsvpResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/trainings/${training.id}/rsvps`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(rsvps).toHaveLength(0);
    });

    it('RSVP is frozen once the training has started', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .put(`/api/v1/trainings/${training.id}/rsvp`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .send({ status: 'YES' })
          .expect(409),
      );
      expect(error.code).toBe('TRAINING_ALREADY_STARTED');
    });

    it('MEMBERS_ONLY rejects an outsider RSVP', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.MEMBERS_ONLY,
      });

      await request(app.getHttpServer())
        .put(`/api/v1/trainings/${training.id}/rsvp`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ status: 'YES' })
        .expect(403);
    });

    // Module: "skoro publiczna to mogą się zapisywać osoby spoza sekcji" -
    // PUBLIC alone is sufficient, there is no separate opt-in to also set.
    it('PUBLIC allows an outsider RSVP', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        visibility: TrainingVisibility.PUBLIC,
      });

      await request(app.getHttpServer())
        .put(`/api/v1/trainings/${training.id}/rsvp`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ status: 'YES' })
        .expect(200);
    });

    it('setting the same RSVP twice never creates a duplicate row', async () => {
      const section = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, section.id, {
        startsAt: '2031-06-13T18:00:00.000Z',
        endsAt: '2031-06-13T20:00:00.000Z',
      });

      await request(app.getHttpServer())
        .put(`/api/v1/trainings/${training.id}/rsvp`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ status: 'YES' })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/v1/trainings/${training.id}/rsvp`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ status: 'YES' })
        .expect(200);

      const rsvps = await bodyOf<TrainingRsvpResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/trainings/${training.id}/rsvps`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(
        rsvps.filter((r) => r.user.id === localUserIdByToken.get(MEMBER_TOKEN)),
      ).toHaveLength(1);
    });
  });

  // ─── SECURITY ────────────────────────────────────────────────────────────

  describe('security', () => {
    it('a Training cannot be edited through a mismatched sectionId (cross-Section IDOR)', async () => {
      const sectionA = await createSectionWithRoles();
      const sectionB = await createSectionWithRoles();
      const training = await createTraining(OWNER_TOKEN, sectionA.id);

      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${sectionB.id}/trainings/${training.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ scope: 'THIS', locationName: 'Hijacked' })
        .expect(404);
    });

    it('an OWNER of a different Section has no TRAINING_MANAGE rights here (404, not 403)', async () => {
      const sectionA = await createSectionWithRoles();
      await createSectionWithRoles(); // sectionB, owned by the same OWNER_TOKEN but a distinct target
      const training = await createTraining(OWNER_TOKEN, sectionA.id);

      // OUTSIDER_TOKEN holds no role anywhere near sectionA.
      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${sectionA.id}/trainings/${training.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .send({ scope: 'THIS', locationName: 'Hijacked' })
        .expect(404);
    });
  });
});
