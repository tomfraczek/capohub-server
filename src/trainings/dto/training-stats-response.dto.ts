import { TrainingUserRefDto } from './training-user-ref.dto';

export interface TrainingStatsUserAttendanceDto {
  user: TrainingUserRefDto;
  attendedCount: number;
}

// Deliberately minimal - see the module spec §14: no streaks, rankings,
// gamification, charts, or materialized aggregates. Computed on read from
// Training/TrainingAttendance, not cached.
export interface TrainingStatsResponseDto {
  trainingsCount: number;
  totalAttendances: number;
  averageAttendeesPerTraining: number;
  attendanceByUser: TrainingStatsUserAttendanceDto[];
}
