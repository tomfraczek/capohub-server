/**
 * E2E tests for Training attendance recording and the trainer's
 * plan/notes access - see the module spec §3/§7/§13.
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
import { createFreshGroupOwner } from './fresh-group-owner.helper';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { TrainingResponseDto } from '../src/trainings/dto/training-response.dto';
import {
  TrainingAttendanceResponseDto,
  TrainingAttendanceRosterEntryDto,
} from '../src/trainings/dto/training-attendance-response.dto';
import { Training } from '../src/trainings/entities/training.entity';
import { TrainingAttendance } from '../src/trainings/entities/training-attendance.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { TrainingRsvp } from '../src/trainings/entities/training-rsvp.entity';
import { TrainingSeries } from '../src/trainings/entities/training-series.entity';
import { TrainingRsvpStatus } from '../src/trainings/enums/training-rsvp-status.enum';
import { TrainingVisibility } from '../src/trainings/enums/training-visibility.enum';

// No fixed "OWNER_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user, and this file needs many
// independent Groups, so createGroup() mints a fresh, throwaway owner per
// call instead (see its own comment).
const ADMIN_TOKEN = 'valid-training-attendance-admin-token';
const MEMBER_TOKEN = 'valid-training-attendance-member-token';
const EXTERNAL_TRAINER_TOKEN =
  'valid-training-attendance-external-trainer-token';
const OUTSIDER_TOKEN = 'valid-training-attendance-outsider-token';

const ADMIN_CLERK_ID = 'user_test_training_attendance_admin';
const MEMBER_CLERK_ID = 'user_test_training_attendance_member';
const EXTERNAL_TRAINER_CLERK_ID =
  'user_test_training_attendance_external_trainer';
const OUTSIDER_CLERK_ID = 'user_test_training_attendance_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_training_attendance_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_training_attendance_admin' },
  },
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_training_attendance_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_training_attendance_member' },
  },
  [EXTERNAL_TRAINER_TOKEN]: {
    userId: EXTERNAL_TRAINER_CLERK_ID,
    sessionId: 'sess_training_attendance_external_trainer',
    tokenType: 'session_token',
    claims: {
      sub: EXTERNAL_TRAINER_CLERK_ID,
      sid: 'sess_training_attendance_external_trainer',
    },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_training_attendance_outsider',
    tokenType: 'session_token',
    claims: {
      sub: OUTSIDER_CLERK_ID,
      sid: 'sess_training_attendance_outsider',
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

describe('Training Attendance (e2e)', () => {
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
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below (see
      // user-profile.e2e-spec.ts's identical cleanup step).
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // FIXTURE_CLERK_PROFILES, not the old frozen TEST_CLERK_USER_IDS
      // snapshot - createGroup (via createFreshGroupOwner) registers a
      // fresh fixture user per call, mutating FIXTURE_CLERK_PROFILES in
      // place, so it must be read fresh here to catch every one of them.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
  });

  function groupPayload(): Record<string, unknown> {
    return {
      name: 'Training Attendance Test Org',
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

  async function createGroup(): Promise<
    GroupResponseDto & { token: string; userId: string }
  > {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'train-att',
      groupOverrides: groupPayload(),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Training Attendance Test Section',
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

  /**
   * OWNER (creator) + ADMIN + MEMBER, all active members of one Section.
   * Each call mints a fresh, throwaway Group owner (see createGroup's own
   * comment) - `.token`/`.userId` are merged onto the returned Section so
   * callers can act as (or reference) that owner afterward.
   */
  async function createSectionWithRoles(): Promise<
    SectionResponseDto & { token: string; userId: string }
  > {
    const group = await createGroup();
    const section = await createSection(group.token, group.id);
    await addSectionMember(group.token, section.id, ADMIN_TOKEN);
    await grantSectionRole(
      group.token,
      section.id,
      ADMIN_TOKEN,
      GroupRole.ADMIN,
    );
    await addSectionMember(group.token, section.id, MEMBER_TOKEN);
    return { ...section, token: group.token, userId: group.userId };
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
          // Just needs to be some valid, always-registered user id - every
          // call site below overrides this explicitly with its own fresh
          // Section owner's id anyway.
          trainerUserId: localUserIdByToken.get(MEMBER_TOKEN),
          description: null,
          visibility: TrainingVisibility.MEMBERS_ONLY,
          ...overrides,
        })
        .expect(201),
    );
  }

  // ─── ATTENDANCE ──────────────────────────────────────────────────────────

  describe('recording attendance', () => {
    it('the assigned trainer can record attendance for a member', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
      });

      const recorded = await bodyOf<TrainingAttendanceResponseDto>(
        request(app.getHttpServer())
          .put(
            `/api/v1/trainings/${training.id}/attendance/${localUserIdByToken.get(
              MEMBER_TOKEN,
            )}`,
          )
          .set('Authorization', `Bearer ${section.token}`)
          .send({ attended: true })
          .expect(200),
      );
      expect(recorded.attended).toBe(true);
      expect(recorded.user.id).toBe(localUserIdByToken.get(MEMBER_TOKEN));
    });

    it('Section ADMIN can record attendance even without being the assigned trainer', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
      });

      await request(app.getHttpServer())
        .put(
          `/api/v1/trainings/${training.id}/attendance/${localUserIdByToken.get(
            MEMBER_TOKEN,
          )}`,
        )
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ attended: true })
        .expect(200);
    });

    it('a participant cannot record their own attendance', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
      });

      await request(app.getHttpServer())
        .put(
          `/api/v1/trainings/${training.id}/attendance/${localUserIdByToken.get(
            MEMBER_TOKEN,
          )}`,
        )
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ attended: true })
        .expect(403);
    });

    it('attendance cannot be recorded before the training starts', async () => {
      const section = await createSectionWithRoles();
      const training = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/trainings`)
          .set('Authorization', `Bearer ${section.token}`)
          .send({
            startsAt: '2031-08-01T18:00:00.000Z',
            endsAt: '2031-08-01T20:00:00.000Z',
            locationName: null,
            locationAddress: null,
            trainerUserId: section.userId,
            description: null,
            visibility: TrainingVisibility.MEMBERS_ONLY,
          })
          .expect(201),
      );

      await request(app.getHttpServer())
        .put(
          `/api/v1/trainings/${training.id}/attendance/${localUserIdByToken.get(
            MEMBER_TOKEN,
          )}`,
        )
        .set('Authorization', `Bearer ${section.token}`)
        .send({ attended: true })
        .expect(409);
    });

    it('recording attendance twice for the same user updates one row, never a duplicate', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
      });
      const memberId = localUserIdByToken.get(MEMBER_TOKEN);

      await request(app.getHttpServer())
        .put(`/api/v1/trainings/${training.id}/attendance/${memberId}`)
        .set('Authorization', `Bearer ${section.token}`)
        .send({ attended: true })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/v1/trainings/${training.id}/attendance/${memberId}`)
        .set('Authorization', `Bearer ${section.token}`)
        .send({ attended: false })
        .expect(200);

      const roster = await bodyOf<TrainingAttendanceRosterEntryDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/trainings/${training.id}/attendance`)
          .set('Authorization', `Bearer ${section.token}`)
          .expect(200),
      );
      const rows = roster.filter((entry) => entry.user.id === memberId);
      expect(rows).toHaveLength(1);
      expect(rows[0].attendance?.attended).toBe(false);
    });

    it('an external RSVP holder (PUBLIC training) may be recorded present', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
        visibility: TrainingVisibility.PUBLIC,
      });

      // The outsider RSVP'd before the training started - simulate by
      // creating a second, not-yet-started training with the same
      // participant/visibility shape for the RSVP call, then recording
      // attendance against the started one directly is not representative;
      // instead RSVP against this exact (already started) training is
      // rejected by design (frozen at startsAt) - so seed the RSVP row
      // directly to represent "RSVP'd before it started".
      const em = app.get(EntityManager).fork();
      const rsvp = new TrainingRsvp();
      rsvp.training = em.getReference(Training, training.id);
      rsvp.user = em.getReference(
        User,
        localUserIdByToken.get(OUTSIDER_TOKEN)!,
      );
      rsvp.status = TrainingRsvpStatus.YES;
      rsvp.respondedAt = new Date();
      await em.persistAndFlush(rsvp);

      const recorded = await bodyOf<TrainingAttendanceResponseDto>(
        request(app.getHttpServer())
          .put(
            `/api/v1/trainings/${training.id}/attendance/${localUserIdByToken.get(
              OUTSIDER_TOKEN,
            )}`,
          )
          .set('Authorization', `Bearer ${section.token}`)
          .send({ attended: true })
          .expect(200),
      );
      expect(recorded.attended).toBe(true);
    });

    it('a user with no membership and no RSVP is not eligible for attendance', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
      });

      await request(app.getHttpServer())
        .put(
          `/api/v1/trainings/${training.id}/attendance/${localUserIdByToken.get(
            OUTSIDER_TOKEN,
          )}`,
        )
        .set('Authorization', `Bearer ${section.token}`)
        .send({ attended: true })
        .expect(400);
    });
  });

  // ─── EXTERNAL TRAINER SCOPE ─────────────────────────────────────────────

  describe('external trainer scope', () => {
    it('an external trainer (no SectionMembership) can record attendance only for their assigned Training', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: localUserIdByToken.get(EXTERNAL_TRAINER_TOKEN),
      });

      await request(app.getHttpServer())
        .put(
          `/api/v1/trainings/${training.id}/attendance/${localUserIdByToken.get(
            MEMBER_TOKEN,
          )}`,
        )
        .set('Authorization', `Bearer ${EXTERNAL_TRAINER_TOKEN}`)
        .send({ attended: true })
        .expect(200);
    });

    it('an external trainer gets no Section admin rights - cannot edit the Training itself', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: localUserIdByToken.get(EXTERNAL_TRAINER_TOKEN),
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/trainings/${training.id}`)
        .set('Authorization', `Bearer ${EXTERNAL_TRAINER_TOKEN}`)
        .send({ scope: 'THIS', locationName: 'Hijacked' })
        .expect(404);
    });

    it("an external trainer cannot manage attendance for a different Training they don't lead", async () => {
      const section = await createSectionWithRoles();
      const ownTraining = await createStartedTraining(
        section.token,
        section.id,
        {
          trainerUserId: localUserIdByToken.get(EXTERNAL_TRAINER_TOKEN),
        },
      );
      const otherTraining = await createStartedTraining(
        section.token,
        section.id,
        {
          trainerUserId: section.userId,
        },
      );
      void ownTraining;

      await request(app.getHttpServer())
        .put(
          `/api/v1/trainings/${otherTraining.id}/attendance/${localUserIdByToken.get(
            MEMBER_TOKEN,
          )}`,
        )
        .set('Authorization', `Bearer ${EXTERNAL_TRAINER_TOKEN}`)
        .send({ attended: true })
        .expect(403);
    });
  });

  // ─── PLAN / NOTES ────────────────────────────────────────────────────────

  describe('trainingPlan / trainerNotes visibility', () => {
    it("the assigned trainer can set and see this Training's plan and notes", async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: localUserIdByToken.get(EXTERNAL_TRAINER_TOKEN),
      });

      const updated = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/trainings/${training.id}/plan-notes`)
          .set('Authorization', `Bearer ${EXTERNAL_TRAINER_TOKEN}`)
          .send({ trainingPlan: 'Ginga drills', trainerNotes: 'Good energy' })
          .expect(200),
      );
      expect(updated.management?.trainingPlan).toBe('Ginga drills');
      expect(updated.management?.trainerNotes).toBe('Good energy');
    });

    it('a plain member never sees trainingPlan/trainerNotes in the Training response', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
      });
      await request(app.getHttpServer())
        .patch(`/api/v1/trainings/${training.id}/plan-notes`)
        .set('Authorization', `Bearer ${section.token}`)
        .send({ trainingPlan: 'Secret plan', trainerNotes: 'Private note' })
        .expect(200);

      const seenByMember = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/trainings/${training.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(seenByMember.management).toBeNull();
      expect(seenByMember).not.toHaveProperty('trainingPlan');
      expect(seenByMember).not.toHaveProperty('trainerNotes');
    });

    it('a member cannot update trainingPlan/trainerNotes', async () => {
      const section = await createSectionWithRoles();
      const training = await createStartedTraining(section.token, section.id, {
        trainerUserId: section.userId,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/trainings/${training.id}/plan-notes`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ trainingPlan: 'Hijacked plan' })
        .expect(403);
    });
  });
});
