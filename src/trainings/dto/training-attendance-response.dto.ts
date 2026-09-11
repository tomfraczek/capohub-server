import { TrainingRsvpStatus } from '../enums/training-rsvp-status.enum';
import { TrainingUserRefDto } from './training-user-ref.dto';

export interface TrainingAttendanceResponseDto {
  id: string;
  trainingId: string;
  user: TrainingUserRefDto;
  attended: boolean;
  recordedBy: TrainingUserRefDto | null;
  recordedAt: string;
}

// One row per person eligible to have attendance recorded for a Training -
// Section members plus, when the Training is PUBLIC, external users who
// RSVP'd YES/MAYBE (see the module spec §7). `attendance` is null for
// anyone not yet recorded.
export interface TrainingAttendanceRosterEntryDto {
  user: TrainingUserRefDto;
  rsvpStatus: TrainingRsvpStatus | null;
  attendance: TrainingAttendanceResponseDto | null;
}

// POST trainings/:trainingId/check-in response - same shape as Event's
// EventCheckInResultDto (see events/dto/event-attendance.dto.ts), kept
// consistent on purpose so both check-in flows read the same way to a
// frontend. `alreadyCheckedIn` is true exactly when this scan changed
// nothing (see TrainingAttendanceService.checkInByIdentity).
export interface TrainingCheckInResultDto {
  user: TrainingUserRefDto;
  attended: true;
  recordedAt: string;
  alreadyCheckedIn: boolean;
}
