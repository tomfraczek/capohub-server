import { TrainingAttendance } from '../entities/training-attendance.entity';
import { TrainingAttendanceResponseDto } from '../dto/training-attendance-response.dto';

export function toTrainingAttendanceResponseDto(
  attendance: TrainingAttendance,
): TrainingAttendanceResponseDto {
  return {
    id: attendance.id,
    trainingId: attendance.training.id,
    user: {
      id: attendance.user.id,
      displayName: attendance.user.displayName,
      gender: attendance.user.gender,
    },
    attended: attendance.attended,
    recordedBy: attendance.recordedBy
      ? {
          id: attendance.recordedBy.id,
          displayName: attendance.recordedBy.displayName,
          gender: attendance.recordedBy.gender,
        }
      : null,
    recordedAt: attendance.recordedAt.toISOString(),
  };
}
