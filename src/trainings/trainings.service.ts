import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { Section } from '../groups/entities/section.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { User } from '../users/entities/user.entity';
import { CancelTrainingInput } from './dto/cancel-training.schema';
import { CreateTrainingInput } from './dto/create-training.schema';
import { TrainingListQueryInput } from './dto/training-list-query.schema';
import { TrainingResponseDto } from './dto/training-response.dto';
import { UpdateTrainingInput } from './dto/update-training.schema';
import { UpdateTrainingPlanNotesInput } from './dto/update-training-plan-notes.schema';
import { Training } from './entities/training.entity';
import { TrainingRsvp } from './entities/training-rsvp.entity';
import { TrainingAccessService } from './training-access.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { TrainingEditScope } from './enums/training-edit-scope.enum';
import { TrainingRsvpStatus } from './enums/training-rsvp-status.enum';
import { TrainingStatus } from './enums/training-status.enum';
import { TrainingVisibility } from './enums/training-visibility.enum';
import { TrainingNotificationsService } from './training-notifications.service';
import {
  assertTrainingNotCancelled,
  assertTrainingNotStarted,
} from './training-write-policy';
import {
  addMinutes,
  buildStartsAt,
  toUtcDateOnly,
} from './training-recurrence.util';
import { toTrainingResponseDto } from './mappers/training.mapper';

export interface TrainingListResult {
  items: TrainingResponseDto[];
  total: number;
  hasMore: boolean;
}

const TRAINING_POPULATE = ['section', 'trainer', 'series'] as const;

// One-off Trainings and every scoped (THIS / THIS_AND_FOLLOWING) mutation
// of a Training that belongs to a TrainingSeries - see
// TrainingSeriesService for series creation and ALL-scope mutations. A
// Training row is always the source of truth for its own date, whether it
// was generated from a series or created directly here (see
// training.entity.ts).
@Injectable()
export class TrainingsService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly trainingAccessService: TrainingAccessService,
    private readonly auditLogService: AuditLogService,
    private readonly trainingNotificationsService: TrainingNotificationsService,
  ) {}

  async create(
    sectionId: string,
    input: CreateTrainingInput,
    actor: User,
  ): Promise<TrainingResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await em.findOne(Section, { id: sectionId });
      if (!section) {
        throw this.sectionNotFound();
      }
      const trainer = await em.findOne(User, { id: input.trainerUserId });
      if (!trainer) {
        throw this.trainerNotFound();
      }

      const training = new Training();
      training.section = section;
      training.series = null;
      training.startsAt = new Date(input.startsAt);
      training.endsAt = new Date(input.endsAt);
      training.locationName = input.locationName;
      training.locationAddress = input.locationAddress;
      training.latitude = input.latitude;
      training.longitude = input.longitude;
      training.trainer = trainer;
      training.description = input.description;
      training.visibility = input.visibility;
      training.allowExternalRsvp = input.allowExternalRsvp;
      training.createdBy = actor;
      await em.persist(training).flush();

      this.auditLogService.record(em, {
        community: section,
        action: AuditAction.CREATE_TRAINING,
        actor,
        targetType: AuditTargetType.TRAINING,
        targetId: training.id,
      });
      await em.flush();

      return this.buildResponse(em, training, actor);
    });
  }

  async list(
    sectionId: string,
    viewer: User,
    query: TrainingListQueryInput,
  ): Promise<TrainingListResult> {
    const em = this.em;
    const section = await em.findOne(Section, { id: sectionId });
    if (!section) {
      throw this.sectionNotFound();
    }

    const isMember = await this.roleAssignmentsService.isCommunityMember(
      sectionId,
      viewer.id,
      em,
    );

    const where: FilterQuery<Training> = { section: sectionId };
    if (query.status) where.status = query.status;
    if (query.from) where.endsAt = { $gte: new Date(query.from) };
    if (query.to) where.startsAt = { $lte: new Date(query.to) };
    if (!isMember) {
      where.visibility = TrainingVisibility.PUBLIC;
    }

    const [trainings, total] = await em.findAndCount(Training, where, {
      populate: [...TRAINING_POPULATE],
      orderBy: { startsAt: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });

    // Sequential, not Promise.all(trainings.map(...)) - each buildResponse
    // issues several queries against the same EntityManager/connection;
    // running them concurrently races at the driver level (same convention
    // as EventsService.list).
    const items: TrainingResponseDto[] = [];
    for (const training of trainings) {
      items.push(await this.buildResponse(em, training, viewer));
    }

    return { items, total, hasMore: query.offset + items.length < total };
  }

  /**
   * The single soonest upcoming, visible, SCHEDULED Training for `viewer` -
   * backs Home.nearestTraining (see HomeService). Mirrors
   * EventsService.findNearestEventAndTraining's own visibility shape:
   * PUBLIC unconditionally, MEMBERS_ONLY only for Sections `viewer` is an
   * active member of. CANCELLED Trainings are never returned (module spec
   * §9/§11).
   */
  async findNearestForViewer(
    viewer: User,
    from: string,
  ): Promise<TrainingResponseDto | null> {
    const em = this.em;
    const mySectionIds = await this.resolveActiveSectionIds(em, viewer.id);

    const where: FilterQuery<Training> = {
      status: TrainingStatus.SCHEDULED,
      startsAt: { $gte: new Date(from) },
      $or: [
        { visibility: TrainingVisibility.PUBLIC },
        ...(mySectionIds.size > 0
          ? [
              {
                visibility: TrainingVisibility.MEMBERS_ONLY,
                section: { $in: [...mySectionIds] },
              },
            ]
          : []),
      ],
    };

    const [trainings] = await em.findAndCount(Training, where, {
      populate: [...TRAINING_POPULATE],
      orderBy: { startsAt: 'asc' },
      limit: 1,
    });

    return trainings[0] ? this.buildResponse(em, trainings[0], viewer) : null;
  }

  /**
   * Every Training belonging to any Section `viewer` currently has an
   * active (ACTIVE/READ_ONLY) membership in, intersecting [from, to) -
   * CalendarService's "my calendar" Training source (see the Calendar
   * module spec § User Calendar). Mirrors list()'s own member rule exactly
   * ("if (!isMember) where.visibility = PUBLIC" - i.e. a member sees every
   * Training in their Section regardless of visibility or their own RSVP),
   * just resolved across every one of `viewer`'s Sections at once instead
   * of one Section at a time. No status filter - CANCELLED Trainings stay
   * visible here too (module spec §9).
   */
  async findForViewerSectionsInRange(
    viewer: User,
    from: string,
    to: string,
  ): Promise<TrainingResponseDto[]> {
    const em = this.em;
    const sectionIds = await this.resolveActiveSectionIds(em, viewer.id);
    if (sectionIds.size === 0) {
      return [];
    }

    const trainings = await em.find(
      Training,
      {
        section: { $in: [...sectionIds] },
        // Intersecting-range, not startsAt-only - same shape as list().
        startsAt: { $lt: new Date(to) },
        endsAt: { $gt: new Date(from) },
      },
      {
        populate: [...TRAINING_POPULATE],
        orderBy: { startsAt: 'asc' },
      },
    );

    // Sequential, not Promise.all(trainings.map(...)) - see list()'s
    // identical comment above.
    const items: TrainingResponseDto[] = [];
    for (const training of trainings) {
      items.push(await this.buildResponse(em, training, viewer));
    }
    return items;
  }

  private async resolveActiveSectionIds(
    em: EntityManager,
    userId: string,
  ): Promise<Set<string>> {
    const memberships = await em.find(
      SectionMembership,
      {
        user: userId,
        status: {
          $in: [
            SectionMembershipStatus.ACTIVE,
            SectionMembershipStatus.READ_ONLY,
          ],
        },
      },
      { fields: ['section'] },
    );
    return new Set(memberships.map((m) => m.section.id));
  }

  async getById(
    trainingId: string,
    viewer: User,
  ): Promise<TrainingResponseDto> {
    const em = this.em;
    const training = await em.findOne(
      Training,
      { id: trainingId },
      { populate: [...TRAINING_POPULATE] },
    );
    if (!training) {
      throw this.trainingAccessService.trainingNotFound();
    }
    const visible = await this.trainingAccessService.isVisibleToViewer(
      em,
      training,
      viewer.id,
    );
    if (!visible) {
      throw this.trainingAccessService.trainingNotFound();
    }
    return this.buildResponse(em, training, viewer);
  }

  async update(
    sectionId: string,
    trainingId: string,
    input: UpdateTrainingInput,
    actor: User,
  ): Promise<TrainingResponseDto> {
    return this.em.transactional(async (em) => {
      const training = await this.loadOwnedOrFail(em, sectionId, trainingId);
      assertTrainingNotCancelled(training);

      if (input.scope === TrainingEditScope.THIS) {
        const changes = this.detectChanges(training, {
          trainerUserId: input.trainerUserId,
          locationName: input.locationName,
          locationAddress: input.locationAddress,
          startsAt: input.startsAt,
        });

        if (input.startsAt !== undefined && input.endsAt !== undefined) {
          training.startsAt = new Date(input.startsAt);
          training.endsAt = new Date(input.endsAt);
        }
        if (input.locationName !== undefined)
          training.locationName = input.locationName;
        if (input.locationAddress !== undefined)
          training.locationAddress = input.locationAddress;
        if (input.latitude !== undefined) training.latitude = input.latitude;
        if (input.longitude !== undefined) training.longitude = input.longitude;
        if (input.trainerUserId !== undefined) {
          const trainer = await em.findOne(User, { id: input.trainerUserId });
          if (!trainer) throw this.trainerNotFound();
          training.trainer = trainer;
        }
        if (input.description !== undefined)
          training.description = input.description;
        if (input.visibility !== undefined)
          training.visibility = input.visibility;
        if (input.allowExternalRsvp !== undefined)
          training.allowExternalRsvp = input.allowExternalRsvp;

        this.recordAudit(em, training, AuditAction.UPDATE_TRAINING, actor, {
          scope: TrainingEditScope.THIS,
        });
        await em.flush();

        await this.sendChangeNotifications(em, [training], changes);
        return this.buildResponse(em, training, actor);
      }

      // scope: THIS_AND_FOLLOWING
      if (!training.series) {
        throw new ConflictException({
          code: 'TRAINING_NOT_IN_SERIES',
          message: 'This training does not belong to a series',
        });
      }
      assertTrainingNotStarted(training);

      const affected = await em.find(
        Training,
        {
          series: training.series.id,
          startsAt: { $gte: training.startsAt },
          status: TrainingStatus.SCHEDULED,
        },
        { populate: [...TRAINING_POPULATE] },
      );

      const changes = this.detectChanges(training, {
        trainerUserId: input.trainerUserId,
        locationName: input.locationName,
        locationAddress: input.locationAddress,
        startTime: input.startTime,
      });

      let trainer: User | null = null;
      if (input.trainerUserId !== undefined) {
        trainer = await em.findOne(User, { id: input.trainerUserId });
        if (!trainer) throw this.trainerNotFound();
      }

      for (const occurrence of affected) {
        if (input.startTime !== undefined) {
          const dateOnly = toUtcDateOnly(occurrence.startsAt);
          const duration =
            input.durationMinutes ?? this.durationMinutes(occurrence);
          occurrence.startsAt = buildStartsAt(dateOnly, input.startTime);
          occurrence.endsAt = addMinutes(occurrence.startsAt, duration);
        } else if (input.durationMinutes !== undefined) {
          occurrence.endsAt = addMinutes(
            occurrence.startsAt,
            input.durationMinutes,
          );
        }
        if (input.locationName !== undefined)
          occurrence.locationName = input.locationName;
        if (input.locationAddress !== undefined)
          occurrence.locationAddress = input.locationAddress;
        if (input.latitude !== undefined) occurrence.latitude = input.latitude;
        if (input.longitude !== undefined)
          occurrence.longitude = input.longitude;
        if (trainer) occurrence.trainer = trainer;
        if (input.description !== undefined)
          occurrence.description = input.description;
        if (input.visibility !== undefined)
          occurrence.visibility = input.visibility;
        if (input.allowExternalRsvp !== undefined)
          occurrence.allowExternalRsvp = input.allowExternalRsvp;
      }

      this.recordAudit(em, training, AuditAction.UPDATE_TRAINING, actor, {
        scope: TrainingEditScope.THIS_AND_FOLLOWING,
        affectedCount: affected.length,
      });
      await em.flush();

      await this.sendChangeNotifications(em, affected, changes);
      return this.buildResponse(em, training, actor);
    });
  }

  async updatePlanNotes(
    trainingId: string,
    input: UpdateTrainingPlanNotesInput,
    actor: User,
  ): Promise<TrainingResponseDto> {
    return this.em.transactional(async (em) => {
      const training = await em.findOne(
        Training,
        { id: trainingId },
        { populate: [...TRAINING_POPULATE] },
      );
      if (!training) {
        throw this.trainingAccessService.trainingNotFound();
      }
      const canManage = await this.trainingAccessService.canManagePrivateFields(
        em,
        training,
        actor.id,
      );
      if (!canManage) {
        // 403, not the guard's usual 404-not-403 - unlike
        // GroupPermissionsGuard's non-holder case, the caller reaching
        // this endpoint already necessarily knows this Training exists
        // (they hold a Training id to address it), so there is no
        // existence-confirmation risk to avoid here.
        throw new ForbiddenException({
          code: 'TRAINING_PRIVATE_FIELDS_FORBIDDEN',
          message:
            "You are not allowed to manage this training's plan or notes",
        });
      }

      if (input.trainingPlan !== undefined)
        training.trainingPlan = input.trainingPlan;
      if (input.trainerNotes !== undefined)
        training.trainerNotes = input.trainerNotes;
      await em.flush();

      return this.buildResponse(em, training, actor);
    });
  }

  async cancel(
    sectionId: string,
    trainingId: string,
    input: CancelTrainingInput,
    actor: User,
  ): Promise<TrainingResponseDto> {
    return this.em.transactional(async (em) => {
      const training = await this.loadOwnedOrFail(em, sectionId, trainingId);
      assertTrainingNotCancelled(training);

      if (input.scope === TrainingEditScope.THIS_AND_FOLLOWING) {
        if (!training.series) {
          throw new ConflictException({
            code: 'TRAINING_NOT_IN_SERIES',
            message: 'This training does not belong to a series',
          });
        }
        assertTrainingNotStarted(training);

        const affected = await em.find(
          Training,
          {
            series: training.series.id,
            startsAt: { $gte: training.startsAt },
            status: TrainingStatus.SCHEDULED,
          },
          { populate: [...TRAINING_POPULATE] },
        );
        for (const occurrence of affected) {
          occurrence.status = TrainingStatus.CANCELLED;
        }
        this.recordAudit(em, training, AuditAction.CANCEL_TRAINING, actor, {
          scope: TrainingEditScope.THIS_AND_FOLLOWING,
          affectedCount: affected.length,
          reason: input.reason,
        });
        await em.flush();

        for (const occurrence of affected) {
          await this.trainingNotificationsService.notify(
            em,
            occurrence,
            NotificationType.TRAINING_CANCELLED,
          );
        }
        return this.buildResponse(em, training, actor);
      }

      training.status = TrainingStatus.CANCELLED;
      this.recordAudit(em, training, AuditAction.CANCEL_TRAINING, actor, {
        scope: TrainingEditScope.THIS,
        reason: input.reason,
      });
      await em.flush();

      await this.trainingNotificationsService.notify(
        em,
        training,
        NotificationType.TRAINING_CANCELLED,
      );
      return this.buildResponse(em, training, actor);
    });
  }

  async buildResponse(
    em: EntityManager,
    training: Training,
    viewer: User,
  ): Promise<TrainingResponseDto> {
    const rsvps = await em.find(
      TrainingRsvp,
      { training: training.id },
      { fields: ['status', 'user'] },
    );
    const rsvpCounts = { yes: 0, no: 0, maybe: 0 };
    let viewerRsvp: TrainingRsvpStatus | null = null;
    for (const rsvp of rsvps) {
      if (rsvp.status === TrainingRsvpStatus.YES) rsvpCounts.yes += 1;
      else if (rsvp.status === TrainingRsvpStatus.NO) rsvpCounts.no += 1;
      else rsvpCounts.maybe += 1;
      if (rsvp.user.id === viewer.id) viewerRsvp = rsvp.status;
    }

    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const canManagePlanNotes =
      await this.trainingAccessService.canManagePrivateFields(
        em,
        training,
        viewer.id,
      );
    const canManageAttendance =
      await this.trainingAccessService.canManageAttendance(
        em,
        training,
        viewer.id,
      );
    const canManage = await this.trainingAccessService.hasSectionPermission(
      em,
      training.section.id,
      viewer.id,
      GroupPermission.TRAINING_MANAGE,
    );

    return toTrainingResponseDto(training, {
      rsvpCounts,
      viewerRsvp,
      management: canManagePlanNotes
        ? {
            trainingPlan: training.trainingPlan,
            trainerNotes: training.trainerNotes,
          }
        : null,
      capabilities: {
        canEdit: canManage,
        canCancel: canManage,
        canManageAttendance,
        canManagePlanNotes,
      },
    });
  }

  private async loadOwnedOrFail(
    em: EntityManager,
    sectionId: string,
    trainingId: string,
  ): Promise<Training> {
    const training = await em.findOne(
      Training,
      { id: trainingId, section: sectionId },
      { populate: [...TRAINING_POPULATE] },
    );
    if (!training) {
      throw this.trainingAccessService.trainingNotFound();
    }
    return training;
  }

  private durationMinutes(training: Training): number {
    return Math.round(
      (training.endsAt.getTime() - training.startsAt.getTime()) / 60_000,
    );
  }

  private detectChanges(
    training: Training,
    input: {
      trainerUserId?: string;
      locationName?: string | null;
      locationAddress?: string | null;
      startsAt?: string;
      startTime?: string;
    },
  ): {
    trainerChanged: boolean;
    locationChanged: boolean;
    timeChanged: boolean;
  } {
    return {
      trainerChanged:
        input.trainerUserId !== undefined &&
        input.trainerUserId !== training.trainer.id,
      locationChanged:
        (input.locationName !== undefined &&
          input.locationName !== training.locationName) ||
        (input.locationAddress !== undefined &&
          input.locationAddress !== training.locationAddress),
      timeChanged:
        input.startsAt !== undefined || input.startTime !== undefined,
    };
  }

  private async sendChangeNotifications(
    em: EntityManager,
    trainings: Training[],
    changes: {
      trainerChanged: boolean;
      locationChanged: boolean;
      timeChanged: boolean;
    },
  ): Promise<void> {
    for (const training of trainings) {
      if (changes.timeChanged) {
        await this.trainingNotificationsService.notify(
          em,
          training,
          NotificationType.TRAINING_TIME_CHANGED,
        );
      }
      if (changes.locationChanged) {
        await this.trainingNotificationsService.notify(
          em,
          training,
          NotificationType.TRAINING_LOCATION_CHANGED,
        );
      }
      if (changes.trainerChanged) {
        await this.trainingNotificationsService.notify(
          em,
          training,
          NotificationType.TRAINING_TRAINER_CHANGED,
        );
      }
    }
  }

  private recordAudit(
    em: EntityManager,
    training: Training,
    action: AuditAction,
    actor: User,
    metadata: Record<string, unknown>,
  ): void {
    this.auditLogService.record(em, {
      community: training.section,
      action,
      actor,
      targetType: AuditTargetType.TRAINING,
      targetId: training.id,
      metadata,
    });
  }

  private sectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
  }

  private trainerNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'TRAINER_NOT_FOUND',
      message: 'No user exists with the given trainerUserId',
    });
  }
}
