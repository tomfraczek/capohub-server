import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { UserCheckInIdentityService } from '../common/identity/user-check-in-identity.service';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { resolveDisplayName } from '../users/display-name.util';
import { User } from '../users/entities/user.entity';
import { RecordTrainingAttendanceInput } from './dto/record-training-attendance.schema';
import {
  TrainingAttendanceResponseDto,
  TrainingAttendanceRosterEntryDto,
  TrainingCheckInResultDto,
} from './dto/training-attendance-response.dto';
import { Training } from './entities/training.entity';
import {
  TRAINING_ATTENDANCES_UNIQUE_INDEX,
  TrainingAttendance,
} from './entities/training-attendance.entity';
import { TrainingRsvp } from './entities/training-rsvp.entity';
import { TrainingAccessService } from './training-access.service';
import { TrainingRsvpStatus } from './enums/training-rsvp-status.enum';
import { TrainingVisibility } from './enums/training-visibility.enum';
import {
  assertTrainingNotCancelled,
  isTrainingStarted,
} from './training-write-policy';
import { toTrainingAttendanceResponseDto } from './mappers/training-attendance.mapper';

const TRAINING_POPULATE = ['section', 'trainer', 'series'] as const;

// Actual, recorded presence - a distinct fact from TrainingRsvp (see the
// module spec §7). Every write here is performed by someone *other* than
// the subject (this Training's own trainer, or a Section
// OWNER/ADMIN/INSTRUCTOR - see TrainingAccessService.canManageAttendance);
// there is deliberately no self-service path. Already shaped so a future
// QR/numericCode resolver can call `record(trainingId, userId, actor)`
// directly once it exists - no numericCode/QR resolution happens here yet
// (out of scope for this stage).
@Injectable()
export class TrainingAttendanceService {
  constructor(
    private readonly em: EntityManager,
    private readonly trainingAccessService: TrainingAccessService,
    private readonly userCheckInIdentityService: UserCheckInIdentityService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * POST trainings/:trainingId/check-in - resolves `identity` (numeric
   * code or QR payload - see UserCheckInIdentityService) to a User, then
   * reuses record() as-is for every existing rule (permission,
   * cancelled/not-started guard, roster eligibility, race-safe upsert -
   * module spec §11: "Nie duplikuj obecnej walidacji"). Idempotent: a
   * re-scan of someone already marked present changes nothing and is never
   * an error - `alreadyCheckedIn` on the response distinguishes it from a
   * fresh check-in (mirrors EventAttendanceService.checkInByIdentity).
   * Audit-logged only on an actual change, same reasoning as record()'s own
   * comment about bulk roster edits not needing one-entry-per-row logging -
   * a single scan is exactly one row, so this one entry *is* the whole
   * action.
   */
  async checkInByIdentity(
    trainingId: string,
    identity: string,
    actor: User,
  ): Promise<TrainingCheckInResultDto> {
    const em = this.em;
    const resolved = await this.userCheckInIdentityService.resolve(
      identity,
      em,
    );

    const existing = await em.findOne(TrainingAttendance, {
      training: trainingId,
      user: resolved.user.id,
    });
    const alreadyCheckedIn = existing?.attended === true;

    const attendance = await this.record(
      trainingId,
      resolved.user.id,
      { attended: true },
      actor,
    );

    if (!alreadyCheckedIn) {
      const training = await this.loadTraining(em, trainingId);
      this.auditLogService.record(em, {
        community: training.section,
        action: AuditAction.RECORD_TRAINING_ATTENDANCE,
        actor,
        targetType: AuditTargetType.USER,
        targetId: resolved.user.id,
        metadata: { trainingId, attended: true },
      });
      await em.flush();
    }

    return {
      user: {
        id: resolved.user.id,
        displayName: resolveDisplayName(resolved.user),
        gender: resolved.user.gender,
      },
      attended: true,
      recordedAt: attendance.recordedAt,
      alreadyCheckedIn,
    };
  }

  async record(
    trainingId: string,
    userId: string,
    input: RecordTrainingAttendanceInput,
    actor: User,
  ): Promise<TrainingAttendanceResponseDto> {
    return this.em.transactional(async (em) => {
      const training = await this.loadTraining(em, trainingId);
      const canManage = await this.trainingAccessService.canManageAttendance(
        em,
        training,
        actor.id,
      );
      if (!canManage) {
        throw new ForbiddenException({
          code: 'TRAINING_ATTENDANCE_FORBIDDEN',
          message: 'You are not allowed to record attendance for this training',
        });
      }

      assertTrainingNotCancelled(training);
      if (!isTrainingStarted(training)) {
        throw new ConflictException({
          code: 'TRAINING_NOT_STARTED',
          message:
            'Attendance can only be recorded once the training has started',
        });
      }

      const user = await em.findOne(User, { id: userId });
      if (!user) {
        throw new BadRequestException({
          code: 'USER_NOT_FOUND',
          message: 'No user exists with the given userId',
        });
      }

      const eligibleIds = await this.resolveEligibleUserIds(em, training);
      if (!eligibleIds.has(userId)) {
        throw new BadRequestException({
          code: 'TRAINING_ATTENDANCE_USER_NOT_ELIGIBLE',
          message: 'This user is not eligible for attendance at this training',
        });
      }

      let attendance = await em.findOne(TrainingAttendance, {
        training: trainingId,
        user: userId,
      });
      const isNew = !attendance;
      if (!attendance) {
        attendance = new TrainingAttendance();
        attendance.training = training;
        attendance.user = user;
      }
      attendance.attended = input.attended;
      attendance.recordedBy = actor;
      attendance.recordedAt = new Date();

      try {
        await em.persist(attendance).flush();
      } catch (error) {
        // Race backstop - same precedent as TrainingRsvpService.setRsvp.
        if (
          isNew &&
          isUniqueViolationOn(error, TRAINING_ATTENDANCES_UNIQUE_INDEX)
        ) {
          const existing = await em.findOneOrFail(TrainingAttendance, {
            training: trainingId,
            user: userId,
          });
          existing.attended = input.attended;
          existing.recordedBy = actor;
          existing.recordedAt = new Date();
          await em.flush();
          return toTrainingAttendanceResponseDto(existing);
        }
        throw error;
      }

      // Deliberately not audit-logged - a checklist-style attendance
      // session can touch every roster row in one sitting, and Audit Log
      // already avoids one-entry-per-row logging for similarly bulk
      // actions elsewhere (see the module spec §16).
      return toTrainingAttendanceResponseDto(attendance);
    });
  }

  async listRoster(
    trainingId: string,
    actor: User,
  ): Promise<TrainingAttendanceRosterEntryDto[]> {
    const em = this.em;
    const training = await this.loadTraining(em, trainingId);
    const canManage = await this.trainingAccessService.canManageAttendance(
      em,
      training,
      actor.id,
    );
    if (!canManage) {
      throw new ForbiddenException({
        code: 'TRAINING_ATTENDANCE_FORBIDDEN',
        message: 'You are not allowed to view attendance for this training',
      });
    }

    const [rsvps, attendances] = await this.loadRsvpsAndAttendances(
      em,
      training,
    );
    const rsvpByUser = new Map(rsvps.map((r) => [r.user.id, r]));
    const attendanceByUser = new Map(attendances.map((a) => [a.user.id, a]));
    const eligibleIds = await this.resolveEligibleUserIds(em, training, rsvps);
    // Members with neither an RSVP nor an attendance row yet still need a
    // name on the roster - one batched load for all of them.
    const otherIds = [...eligibleIds].filter(
      (userId) => !rsvpByUser.has(userId) && !attendanceByUser.has(userId),
    );
    const otherUsers =
      otherIds.length > 0 ? await em.find(User, { id: { $in: otherIds } }) : [];
    const otherUserById = new Map(otherUsers.map((user) => [user.id, user]));

    const entries: TrainingAttendanceRosterEntryDto[] = [];
    for (const userId of eligibleIds) {
      const rsvp = rsvpByUser.get(userId);
      const attendance = attendanceByUser.get(userId);
      const user =
        rsvp?.user ?? attendance?.user ?? otherUserById.get(userId) ?? null;
      entries.push({
        user: user
          ? {
              id: user.id,
              displayName: resolveDisplayName(user),
              gender: user.gender,
            }
          : { id: userId, displayName: '', gender: null },
        rsvpStatus: rsvp?.status ?? null,
        attendance: attendance
          ? toTrainingAttendanceResponseDto(attendance)
          : null,
      });
    }
    return entries;
  }

  private async loadRsvpsAndAttendances(
    em: EntityManager,
    training: Training,
  ): Promise<[TrainingRsvp[], TrainingAttendance[]]> {
    const rsvps = await em.find(
      TrainingRsvp,
      { training: training.id },
      { populate: ['user'] },
    );
    const attendances = await em.find(
      TrainingAttendance,
      { training: training.id },
      { populate: ['user'] },
    );
    return [rsvps, attendances];
  }

  /**
   * Every user allowed to have attendance recorded for `training` - active
   * members of its Section, plus (only when the Training is PUBLIC - see
   * TrainingAccessService.canRsvp) anyone who RSVP'd YES/MAYBE regardless
   * of membership (see the module spec §7).
   */
  private async resolveEligibleUserIds(
    em: EntityManager,
    training: Training,
    preloadedRsvps?: TrainingRsvp[],
  ): Promise<Set<string>> {
    const memberships = await em.find(
      SectionMembership,
      {
        section: training.section.id,
        status: {
          $in: [
            SectionMembershipStatus.ACTIVE,
            SectionMembershipStatus.READ_ONLY,
          ],
        },
      },
      { fields: ['user'] },
    );
    const ids = new Set(memberships.map((m) => m.user.id));

    if (training.visibility === TrainingVisibility.PUBLIC) {
      const rsvps =
        preloadedRsvps ??
        (await em.find(
          TrainingRsvp,
          {
            training: training.id,
            status: { $in: [TrainingRsvpStatus.YES, TrainingRsvpStatus.MAYBE] },
          },
          { fields: ['user', 'status'] },
        ));
      for (const rsvp of rsvps) {
        if (
          rsvp.status === TrainingRsvpStatus.YES ||
          rsvp.status === TrainingRsvpStatus.MAYBE
        ) {
          ids.add(rsvp.user.id);
        }
      }
    }
    return ids;
  }

  private async loadTraining(
    em: EntityManager,
    trainingId: string,
  ): Promise<Training> {
    const training = await em.findOne(
      Training,
      { id: trainingId },
      { populate: [...TRAINING_POPULATE] },
    );
    if (!training) {
      throw this.trainingAccessService.trainingNotFound();
    }
    return training;
  }
}
