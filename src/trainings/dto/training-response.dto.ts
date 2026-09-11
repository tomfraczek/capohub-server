import { TrainingRsvpStatus } from '../enums/training-rsvp-status.enum';
import { TrainingStatus } from '../enums/training-status.enum';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import {
  TrainingSectionRefDto,
  TrainingUserRefDto,
} from './training-user-ref.dto';

export interface TrainingRsvpCountsDto {
  yes: number;
  no: number;
  maybe: number;
}

// trainingPlan/trainerNotes are only ever populated when the viewer is
// authorized to see them (this Training's own trainer, or a Section
// OWNER/ADMIN/INSTRUCTOR - see the module spec §13 and
// TrainingAccessService.canManagePrivateFields) - `null` here never
// distinguishes "empty" from "hidden": the whole `management` object is
// omitted (null) whenever the viewer isn't authorized at all, same pattern
// as EventResponseDto.capabilities gating writes.
export interface TrainingManagementDto {
  trainingPlan: string | null;
  trainerNotes: string | null;
}

export interface TrainingCapabilitiesDto {
  canEdit: boolean;
  canCancel: boolean;
  canManageAttendance: boolean;
  canManagePlanNotes: boolean;
}

export interface TrainingResponseDto {
  id: string;
  section: TrainingSectionRefDto;
  seriesId: string | null;
  startsAt: string;
  endsAt: string;
  locationName: string | null;
  locationAddress: string | null;
  // null = no one assigned (module: "prowadzący opcjonalny") - never
  // defaulted to the creator or anyone else.
  trainer: TrainingUserRefDto | null;
  description: string | null;
  visibility: TrainingVisibility;
  status: TrainingStatus;
  rsvpCounts: TrainingRsvpCountsDto;
  viewerRsvp: TrainingRsvpStatus | null;
  management: TrainingManagementDto | null;
  capabilities: TrainingCapabilitiesDto;
  createdAt: string;
  updatedAt: string;
}
