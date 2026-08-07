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
// Section members plus, when allowExternalRsvp is true, external users who
// RSVP'd YES/MAYBE (see the module spec §7). `attendance` is null for
// anyone not yet recorded.
export interface TrainingAttendanceRosterEntryDto {
  user: TrainingUserRefDto;
  rsvpStatus: TrainingRsvpStatus | null;
  attendance: TrainingAttendanceResponseDto | null;
}
