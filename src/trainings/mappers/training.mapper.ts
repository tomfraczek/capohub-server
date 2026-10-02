import {
  PublicUrlBuilder,
  resolveImageUrl,
} from '../../storage/image-url.util';
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
  urlBuilder: PublicUrlBuilder,
): TrainingResponseDto {
  return {
    id: training.id,
    section: {
      id: training.section.id,
      name: training.section.name,
      // Prefers the R2 public URL derived from profileImageKey over the
      // legacy logoUrl column once an upload exists - see
      // storage/image-url.util.ts's resolveImageUrl.
      logoUrl: resolveImageUrl(
        training.section.profileImageKey,
        training.section.logoUrl,
        urlBuilder,
      ),
    },
    seriesId: training.series?.id ?? null,
    startsAt: training.startsAt.toISOString(),
    endsAt: training.endsAt.toISOString(),
    locationName: training.locationName,
    locationAddress: training.locationAddress,
    trainer: training.trainer
      ? {
          id: training.trainer.id,
          displayName: training.trainer.displayName,
          gender: training.trainer.gender,
        }
      : null,
    description: training.description,
    visibility: training.visibility,
    status: training.status,
    rsvpCounts: context.rsvpCounts,
    viewerRsvp: context.viewerRsvp,
    management: context.management,
    capabilities: context.capabilities,
    createdAt: training.createdAt.toISOString(),
    updatedAt: training.updatedAt.toISOString(),
  };
}
