import { Training } from '../entities/training.entity';
import {
  TrainingCapabilitiesDto,
  TrainingManagementDto,
  TrainingResponseDto,
  TrainingRsvpCountsDto,
} from '../dto/training-response.dto';
import { TrainingRsvpStatus } from '../enums/training-rsvp-status.enum';

export function toTrainingResponseDto(
  training: Training,
  context: {
    rsvpCounts: TrainingRsvpCountsDto;
    viewerRsvp: TrainingRsvpStatus | null;
    management: TrainingManagementDto | null;
    capabilities: TrainingCapabilitiesDto;
  },
): TrainingResponseDto {
  return {
    id: training.id,
    section: {
      id: training.section.id,
      name: training.section.name,
      logoUrl: training.section.logoUrl,
    },
    seriesId: training.series?.id ?? null,
    startsAt: training.startsAt.toISOString(),
    endsAt: training.endsAt.toISOString(),
    locationName: training.locationName,
    locationAddress: training.locationAddress,
    latitude: training.latitude,
    longitude: training.longitude,
    trainer: {
      id: training.trainer.id,
      displayName: training.trainer.displayName,
    },
    description: training.description,
    visibility: training.visibility,
    allowExternalRsvp: training.allowExternalRsvp,
    status: training.status,
    rsvpCounts: context.rsvpCounts,
    viewerRsvp: context.viewerRsvp,
    management: context.management,
    capabilities: context.capabilities,
    createdAt: training.createdAt.toISOString(),
    updatedAt: training.updatedAt.toISOString(),
  };
}
