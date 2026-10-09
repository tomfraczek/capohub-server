import { TrainingUserRefDto } from './dto/training-user-ref.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Section } from '../groups/entities/section.entity';
import { TrainingStatsQueryInput } from './dto/training-stats-query.schema';
import { TrainingStatsResponseDto } from './dto/training-stats-response.dto';
import { Training } from './entities/training.entity';
import { TrainingAttendance } from './entities/training-attendance.entity';
import { TrainingStatus } from './enums/training-status.enum';
import { resolveDisplayName } from '../users/display-name.util';

// Deliberately minimal, read-only aggregation over Training/
// TrainingAttendance - no materialized aggregates, no streaks/rankings/
// gamification/charts (see the module spec §14). Gated to Section
// OWNER/ADMIN only via GroupPermission.TRAINING_STATS_VIEW at the
// controller (TrainingPermissionsGuard) - this service does not re-check
// authorization.
@Injectable()
export class TrainingStatsService {
  constructor(private readonly em: EntityManager) {}

  async getStats(
    sectionId: string,
    query: TrainingStatsQueryInput,
  ): Promise<TrainingStatsResponseDto> {
    const em = this.em;
    const section = await em.findOne(Section, { id: sectionId });
    if (!section) {
      throw new NotFoundException({
        code: 'SECTION_NOT_FOUND',
        message: 'Section not found',
      });
    }

    const dateFrom = new Date(query.dateFrom);
    const dateTo = new Date(query.dateTo);

    const trainings = await em.find(
      Training,
      {
        section: sectionId,
        status: TrainingStatus.SCHEDULED,
        startsAt: { $gte: dateFrom, $lte: dateTo },
      },
      { fields: ['id'] },
    );
    const trainingIds = trainings.map((t) => t.id);
    const trainingsCount = trainingIds.length;

    if (trainingsCount === 0) {
      return {
        trainingsCount: 0,
        totalAttendances: 0,
        averageAttendeesPerTraining: 0,
        attendanceByUser: [],
      };
    }

    const attendances = await em.find(
      TrainingAttendance,
      { training: { $in: trainingIds }, attended: true },
      { populate: ['user'] },
    );

    const totalAttendances = attendances.length;
    const averageAttendeesPerTraining =
      Math.round((totalAttendances / trainingsCount) * 100) / 100;

    const byUser = new Map<
      string,
      { user: TrainingUserRefDto; attendedCount: number }
    >();
    for (const attendance of attendances) {
      const existing = byUser.get(attendance.user.id);
      if (existing) {
        existing.attendedCount += 1;
      } else {
        byUser.set(attendance.user.id, {
          user: {
            id: attendance.user.id,
            displayName: resolveDisplayName(attendance.user),
            gender: attendance.user.gender,
          },
          attendedCount: 1,
        });
      }
    }

    return {
      trainingsCount,
      totalAttendances,
      averageAttendeesPerTraining,
      attendanceByUser: [...byUser.values()].sort(
        (a, b) => b.attendedCount - a.attendedCount,
      ),
    };
  }
}
