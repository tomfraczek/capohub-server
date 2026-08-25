import {
  PublicUrlBuilder,
  resolveImageUrl,
} from '../../storage/image-url.util';
import { TrainingSeries } from '../entities/training-series.entity';
import { TrainingSeriesResponseDto } from '../dto/training-series-response.dto';

export function toTrainingSeriesResponseDto(
  series: TrainingSeries,
  generatedTrainingsCount: number,
  urlBuilder: PublicUrlBuilder,
): TrainingSeriesResponseDto {
  return {
    id: series.id,
    section: {
      id: series.section.id,
      name: series.section.name,
      // Prefers the R2 public URL derived from profileImageKey over the
      // legacy logoUrl column once an upload exists - see
      // storage/image-url.util.ts's resolveImageUrl.
      logoUrl: resolveImageUrl(
        series.section.profileImageKey,
        series.section.logoUrl,
        urlBuilder,
      ),
    },
    dayOfWeek: series.dayOfWeek,
    startTime: series.startTime,
    durationMinutes: series.durationMinutes,
    locationName: series.locationName,
    locationAddress: series.locationAddress,
    latitude: series.latitude,
    longitude: series.longitude,
    defaultTrainer: {
      id: series.defaultTrainer.id,
      displayName: series.defaultTrainer.displayName,
    },
    defaultDescription: series.defaultDescription,
    visibility: series.visibility,
    allowExternalRsvp: series.allowExternalRsvp,
    startDate: series.startDate.toISOString().slice(0, 10),
    endDate: series.endDate.toISOString().slice(0, 10),
    generatedTrainingsCount,
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
  };
}
