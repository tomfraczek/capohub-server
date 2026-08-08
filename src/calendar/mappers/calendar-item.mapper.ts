import { EventRsvpStatus } from '../../events/enums/event-rsvp-status.enum';
import { EventStatus } from '../../events/enums/event-status.enum';
import { EventResponseDto } from '../../events/dto/event-response.dto';
import { TrainingResponseDto } from '../../trainings/dto/training-response.dto';
import { TrainingStatus } from '../../trainings/enums/training-status.enum';
import {
  CalendarCommunityRefDto,
  CalendarEventItemDto,
  CalendarTrainingItemDto,
} from '../dto/calendar-item.dto';

// Stable calendar item ids ("event:<uuid>" / "training:<uuid>") - never a
// freshly generated uuid on every read (module spec §3). `sourceId` carries
// the real Event/Training id for the frontend to open the underlying
// resource.
export function toCalendarEventItem(
  event: EventResponseDto,
  viewerRsvp: EventRsvpStatus | null,
): CalendarEventItemDto {
  return {
    id: `event:${event.id}`,
    type: 'EVENT',
    sourceId: event.id,
    title: event.name,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    status: event.status,
    isCancelled: event.status === EventStatus.CANCELLED,
    community: toCalendarCommunityRef(event.community),
    eventType: event.type,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    viewerRsvp,
  };
}

export function toCalendarTrainingItem(
  training: TrainingResponseDto,
): CalendarTrainingItemDto {
  return {
    id: `training:${training.id}`,
    type: 'TRAINING',
    sourceId: training.id,
    // Training has no `name`/title field of its own (see training.entity.ts)
    // - a fixed, honest label rather than synthesizing one from
    // trainer/section (already available separately on this item for the
    // frontend to compose its own label - see the module spec §2).
    title: 'Training',
    startsAt: training.startsAt,
    endsAt: training.endsAt,
    status: training.status,
    isCancelled: training.status === TrainingStatus.CANCELLED,
    community: {
      id: training.section.id,
      type: 'SECTION',
      name: training.section.name,
    },
    trainer: {
      id: training.trainer.id,
      displayName: training.trainer.displayName,
    },
    locationName: training.locationName,
    locationAddress: training.locationAddress,
    userRsvp: training.viewerRsvp,
    isRecurring: training.seriesId !== null,
    seriesId: training.seriesId,
  };
}

function toCalendarCommunityRef(
  community: EventResponseDto['community'],
): CalendarCommunityRefDto {
  return {
    id: community.id,
    type: community.communityType,
    name: community.name,
  };
}
