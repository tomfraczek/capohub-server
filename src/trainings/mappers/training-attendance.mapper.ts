import { TrainingAttendance } from '../entities/training-attendance.entity';
import { TrainingAttendanceResponseDto } from '../dto/training-attendance-response.dto';
import { resolveDisplayName } from '../../users/display-name.util';

export function toTrainingAttendanceResponseDto(
  attendance: TrainingAttendance,
): TrainingAttendanceResponseDto {
  return {
    id: attendance.id,
    trainingId: attendance.training.id,
    user: {
      id: attendance.user.id,
      displayName: resolveDisplayName(attendance.user),
      gender: attendance.user.gender,
    },
    attended: attendance.attended,
    recordedBy: attendance.recordedBy
      ? {
          id: attendance.recordedBy.id,
          displayName: resolveDisplayName(attendance.recordedBy),
          gender: attendance.recordedBy.gender,
        }
      : null,
    recordedAt: attendance.recordedAt.toISOString(),
  };
}
