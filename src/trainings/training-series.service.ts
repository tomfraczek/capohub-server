import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { Section } from '../groups/entities/section.entity';
import { User } from '../users/entities/user.entity';
import { CancelTrainingSeriesInput } from './dto/cancel-training-series.schema';
import { CreateTrainingSeriesInput } from './dto/create-training-series.schema';
import { TrainingSeriesResponseDto } from './dto/training-series-response.dto';
import { UpdateTrainingSeriesInput } from './dto/update-training-series.schema';
import { Training } from './entities/training.entity';
import { TrainingAttendance } from './entities/training-attendance.entity';
import { TrainingRsvp } from './entities/training-rsvp.entity';
import { TrainingSeries } from './entities/training-series.entity';
import { TrainingAccessService } from './training-access.service';
import { TrainingNotificationType } from './enums/training-notification-type.enum';
import { TrainingStatus } from './enums/training-status.enum';
import { TrainingNotificationsService } from './training-notifications.service';
import {
  addMinutes,
  buildStartsAt,
  dateKey,
  generateOccurrenceDates,
  maxSeriesEndDate,
  toUtcDateOnly,
} from './training-recurrence.util';
import { toTrainingSeriesResponseDto } from './mappers/training-series.mapper';

const TRAINING_POPULATE = ['section', 'trainer', 'series'] as const;

// TrainingSeries creation and every ALL-scope mutation (see
// TrainingEditScope's own comment - a series-level PATCH/cancel always
// applies to the whole future, not-yet-started tail of the series). THIS
// and THIS_AND_FOLLOWING scope live on TrainingsService instead.
@Injectable()
export class TrainingSeriesService {
  constructor(
    private readonly em: EntityManager,
    private readonly trainingAccessService: TrainingAccessService,
    private readonly auditLogService: AuditLogService,
    private readonly trainingNotificationsService: TrainingNotificationsService,
  ) {}

  async create(
    sectionId: string,
    input: CreateTrainingSeriesInput,
    actor: User,
  ): Promise<TrainingSeriesResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await em.findOne(Section, { id: sectionId });
      if (!section) {
        throw this.sectionNotFound();
      }
      const trainer = await em.findOne(User, {
        id: input.defaultTrainerUserId,
      });
      if (!trainer) {
        throw this.trainerNotFound();
      }

      const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
      const endDate = new Date(`${input.endDate}T00:00:00.000Z`);

      const series = new TrainingSeries();
      series.section = section;
      series.dayOfWeek = input.dayOfWeek;
      series.startTime = input.startTime;
      series.durationMinutes = input.durationMinutes;
      series.locationName = input.locationName;
      series.locationAddress = input.locationAddress;
      series.latitude = input.latitude;
      series.longitude = input.longitude;
      series.defaultTrainer = trainer;
      series.defaultDescription = input.defaultDescription;
      series.visibility = input.visibility;
      series.allowExternalRsvp = input.allowExternalRsvp;
      series.startDate = startDate;
      series.endDate = endDate;
      series.createdBy = actor;
      await em.persist(series).flush();

      const dates = generateOccurrenceDates(
        startDate,
        endDate,
        input.dayOfWeek,
      );
      for (const date of dates) {
        em.persist(this.buildTrainingFromSeries(series, date));
      }
      await em.flush();

      this.auditLogService.record(em, {
        community: section,
        action: AuditAction.CREATE_TRAINING_SERIES,
        actor,
        targetType: AuditTargetType.TRAINING_SERIES,
        targetId: series.id,
        metadata: { generatedCount: dates.length },
      });
      await em.flush();

      return toTrainingSeriesResponseDto(series, dates.length);
    });
  }

  async list(sectionId: string): Promise<TrainingSeriesResponseDto[]> {
    const em = this.em;
    const section = await em.findOne(Section, { id: sectionId });
    if (!section) {
      throw this.sectionNotFound();
    }
    const seriesList = await em.find(
      TrainingSeries,
      { section: sectionId },
      {
        populate: ['section', 'defaultTrainer'],
        orderBy: { createdAt: 'asc' },
      },
    );

    const results: TrainingSeriesResponseDto[] = [];
    for (const series of seriesList) {
      const count = await em.count(Training, { series: series.id });
      results.push(toTrainingSeriesResponseDto(series, count));
    }
    return results;
  }

  async getById(
    sectionId: string,
    seriesId: string,
  ): Promise<TrainingSeriesResponseDto> {
    const em = this.em;
    const series = await this.loadOwnedOrFail(em, sectionId, seriesId);
    const count = await em.count(Training, { series: series.id });
    return toTrainingSeriesResponseDto(series, count);
  }

  async update(
    sectionId: string,
    seriesId: string,
    input: UpdateTrainingSeriesInput,
    actor: User,
  ): Promise<TrainingSeriesResponseDto> {
    return this.em.transactional(async (em) => {
      const series = await this.loadOwnedOrFail(em, sectionId, seriesId);
      const now = new Date();

      let trainer: User | null = null;
      if (input.defaultTrainerUserId !== undefined) {
        trainer = await em.findOne(User, { id: input.defaultTrainerUserId });
        if (!trainer) throw this.trainerNotFound();
      }

      const recurrenceChanged =
        input.dayOfWeek !== undefined && input.dayOfWeek !== series.dayOfWeek;
      const previousEndDate = series.endDate;
      let newEndDate = series.endDate;
      if (input.endDate !== undefined) {
        newEndDate = new Date(`${input.endDate}T00:00:00.000Z`);
        if (newEndDate.getTime() < series.startDate.getTime()) {
          throw new BadRequestException({
            code: 'INVALID_END_DATE',
            message: 'endDate must not be before the series startDate',
          });
        }
        const maxEnd = maxSeriesEndDate(series.startDate);
        if (newEndDate.getTime() > maxEnd.getTime()) {
          throw new BadRequestException({
            code: 'TRAINING_SERIES_TOO_LONG',
            message: 'endDate must be at most 3 years after startDate',
          });
        }
      }
      const endDateChanged = newEndDate.getTime() !== previousEndDate.getTime();

      const trainerChanged =
        trainer !== null && trainer.id !== series.defaultTrainer.id;
      const locationChanged =
        (input.locationName !== undefined &&
          input.locationName !== series.locationName) ||
        (input.locationAddress !== undefined &&
          input.locationAddress !== series.locationAddress);
      const timeOfDayChanged =
        (input.startTime !== undefined &&
          input.startTime !== series.startTime) ||
        (input.durationMinutes !== undefined &&
          input.durationMinutes !== series.durationMinutes);

      // Apply every provided template field to the series row itself first -
      // buildTrainingFromSeries/applyTemplateFields below always read the
      // *new* values back off `series`.
      if (input.dayOfWeek !== undefined) series.dayOfWeek = input.dayOfWeek;
      if (input.startTime !== undefined) series.startTime = input.startTime;
      if (input.durationMinutes !== undefined)
        series.durationMinutes = input.durationMinutes;
      if (input.locationName !== undefined)
        series.locationName = input.locationName;
      if (input.locationAddress !== undefined)
        series.locationAddress = input.locationAddress;
      if (input.latitude !== undefined) series.latitude = input.latitude;
      if (input.longitude !== undefined) series.longitude = input.longitude;
      if (trainer) series.defaultTrainer = trainer;
      if (input.defaultDescription !== undefined)
        series.defaultDescription = input.defaultDescription;
      if (input.visibility !== undefined) series.visibility = input.visibility;
      if (input.allowExternalRsvp !== undefined)
        series.allowExternalRsvp = input.allowExternalRsvp;
      series.endDate = newEndDate;

      const future = await em.find(
        Training,
        {
          series: series.id,
          startsAt: { $gt: now },
          status: TrainingStatus.SCHEDULED,
        },
        { populate: [...TRAINING_POPULATE] },
      );

      const datesPatternChanged = recurrenceChanged || endDateChanged;
      const notifyTimeChanged: Training[] = [];
      const notifyLocationChanged: Training[] = [];
      const notifyTrainerChanged: Training[] = [];

      if (!datesPatternChanged) {
        // Only simple field/time-of-day changes - every future occurrence
        // keeps its own calendar date, just updated in place. RSVP/
        // attendance rows are untouched (same training id).
        for (const occurrence of future) {
          if (timeOfDayChanged) notifyTimeChanged.push(occurrence);
          if (locationChanged) notifyLocationChanged.push(occurrence);
          if (
            trainerChanged &&
            occurrence.trainer.id !== series.defaultTrainer.id
          ) {
            notifyTrainerChanged.push(occurrence);
          }
          this.applyTemplateFields(occurrence, series);
          if (timeOfDayChanged) {
            const dateOnly = toUtcDateOnly(occurrence.startsAt);
            occurrence.startsAt = buildStartsAt(dateOnly, series.startTime);
            occurrence.endsAt = addMinutes(
              occurrence.startsAt,
              series.durationMinutes,
            );
          }
        }
      } else {
        // The recurrence rule and/or date range changed - reconcile the
        // future tail against a freshly computed target date set (see the
        // module spec §8's "safe strategy" requirement).
        const targetDates = generateOccurrenceDates(
          now,
          newEndDate,
          series.dayOfWeek,
        );
        const targetKeys = new Set(targetDates.map(dateKey));
        const keptKeys = new Set<string>();

        for (const occurrence of future) {
          const key = dateKey(occurrence.startsAt);
          if (targetKeys.has(key)) {
            this.applyTemplateFields(occurrence, series);
            const dateOnly = toUtcDateOnly(occurrence.startsAt);
            occurrence.startsAt = buildStartsAt(dateOnly, series.startTime);
            occurrence.endsAt = addMinutes(
              occurrence.startsAt,
              series.durationMinutes,
            );
            keptKeys.add(key);
            notifyTimeChanged.push(occurrence);
            continue;
          }

          // This date no longer belongs to the new pattern. Never silently
          // delete a Training with real engagement - keep it as a
          // standalone occurrence (still linked to the series for
          // history), updated to the new simple field defaults but with
          // its own original date/time preserved.
          const hasEngagement =
            (await em.count(TrainingRsvp, { training: occurrence.id })) > 0 ||
            (await em.count(TrainingAttendance, { training: occurrence.id })) >
              0;
          if (hasEngagement) {
            this.applyTemplateFields(occurrence, series);
            notifyLocationChanged.push(occurrence);
          } else {
            em.remove(occurrence);
          }
        }

        for (const date of targetDates) {
          const key = dateKey(date);
          if (keptKeys.has(key)) continue;
          em.persist(this.buildTrainingFromSeries(series, date));
        }
      }

      this.auditLogService.record(em, {
        community: series.section,
        action: AuditAction.UPDATE_TRAINING_SERIES,
        actor,
        targetType: AuditTargetType.TRAINING_SERIES,
        targetId: series.id,
        metadata: {
          recurrenceChanged,
          endDateChanged,
          affectedCount: future.length,
        },
      });
      await em.flush();

      for (const training of notifyTimeChanged) {
        await this.trainingNotificationsService.notify(
          em,
          training,
          TrainingNotificationType.TRAINING_TIME_CHANGED,
        );
      }
      for (const training of notifyLocationChanged) {
        await this.trainingNotificationsService.notify(
          em,
          training,
          TrainingNotificationType.TRAINING_LOCATION_CHANGED,
        );
      }
      for (const training of notifyTrainerChanged) {
        await this.trainingNotificationsService.notify(
          em,
          training,
          TrainingNotificationType.TRAINING_TRAINER_CHANGED,
        );
      }
      const count = await em.count(Training, { series: series.id });
      return toTrainingSeriesResponseDto(series, count);
    });
  }

  async cancel(
    sectionId: string,
    seriesId: string,
    input: CancelTrainingSeriesInput,
    actor: User,
  ): Promise<TrainingSeriesResponseDto> {
    return this.em.transactional(async (em) => {
      const series = await this.loadOwnedOrFail(em, sectionId, seriesId);
      const now = new Date();

      const future = await em.find(
        Training,
        {
          series: series.id,
          startsAt: { $gt: now },
          status: TrainingStatus.SCHEDULED,
        },
        { populate: [...TRAINING_POPULATE] },
      );
      for (const occurrence of future) {
        occurrence.status = TrainingStatus.CANCELLED;
      }

      this.auditLogService.record(em, {
        community: series.section,
        action: AuditAction.CANCEL_TRAINING_SERIES,
        actor,
        targetType: AuditTargetType.TRAINING_SERIES,
        targetId: series.id,
        metadata: { affectedCount: future.length, reason: input.reason },
      });
      await em.flush();

      for (const occurrence of future) {
        await this.trainingNotificationsService.notify(
          em,
          occurrence,
          TrainingNotificationType.TRAINING_CANCELLED,
        );
      }

      const count = await em.count(Training, { series: series.id });
      return toTrainingSeriesResponseDto(series, count);
    });
  }

  private buildTrainingFromSeries(
    series: TrainingSeries,
    date: Date,
  ): Training {
    const training = new Training();
    training.section = series.section;
    training.series = series;
    training.startsAt = buildStartsAt(date, series.startTime);
    training.endsAt = addMinutes(training.startsAt, series.durationMinutes);
    training.locationName = series.locationName;
    training.locationAddress = series.locationAddress;
    training.latitude = series.latitude;
    training.longitude = series.longitude;
    training.trainer = series.defaultTrainer;
    training.description = series.defaultDescription;
    training.visibility = series.visibility;
    training.allowExternalRsvp = series.allowExternalRsvp;
    training.createdBy = series.createdBy;
    return training;
  }

  private applyTemplateFields(
    training: Training,
    series: TrainingSeries,
  ): void {
    training.locationName = series.locationName;
    training.locationAddress = series.locationAddress;
    training.latitude = series.latitude;
    training.longitude = series.longitude;
    training.trainer = series.defaultTrainer;
    training.description = series.defaultDescription;
    training.visibility = series.visibility;
    training.allowExternalRsvp = series.allowExternalRsvp;
  }

  private async loadOwnedOrFail(
    em: EntityManager,
    sectionId: string,
    seriesId: string,
  ): Promise<TrainingSeries> {
    const series = await em.findOne(
      TrainingSeries,
      { id: seriesId, section: sectionId },
      { populate: ['section', 'defaultTrainer'] },
    );
    if (!series) {
      throw this.trainingAccessService.trainingSeriesNotFound();
    }
    return series;
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
      message: 'No user exists with the given defaultTrainerUserId',
    });
  }
}
