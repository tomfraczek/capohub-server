import { TrainingVisibility } from '../enums/training-visibility.enum';
import {
  TrainingSectionRefDto,
  TrainingUserRefDto,
} from './training-user-ref.dto';

export interface TrainingSeriesResponseDto {
  id: string;
  section: TrainingSectionRefDto;
  dayOfWeek: number;
  startTime: string;
  durationMinutes: number;
  locationName: string | null;
  locationAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  defaultTrainer: TrainingUserRefDto;
  defaultDescription: string | null;
  visibility: TrainingVisibility;
  allowExternalRsvp: boolean;
  startDate: string;
  endDate: string;
  // Every currently-existing Training generated from this series (past,
  // future, and cancelled alike) - not just the future tail a scoped
  // update/cancel may touch. See TrainingSeriesService.
  generatedTrainingsCount: number;
  createdAt: string;
  updatedAt: string;
}
