import { buildEventQrPayload } from '../../common/identity/qr-payload.util';
import {
  PublicUrlBuilder,
  resolveImageUrl,
} from '../../storage/image-url.util';
import { Event } from '../entities/event.entity';
import { EventScheduleDay } from '../entities/event-schedule-day.entity';
import { eventCommunity } from '../event-community.util';
import { EventCapabilitiesDto } from '../dto/event-capabilities.dto';
import {
  EventResponseDto,
  EventScheduleDayResponseDto,
} from '../dto/event-response.dto';
import { EventRole } from '../enums/event-role.enum';
import { toEventCommunityRefDto } from './event-community-ref.mapper';
import { toEventOrganizerRefDto } from './event-organizer-ref.mapper';

export interface EventAggregateContext {
  viewerRoles: EventRole[];
  capabilities: EventCapabilitiesDto;
  seatsTaken: number;
  seatsAvailable: number | null;
  waitlistCount: number;
  // Always passed explicitly, same "in-memory on create/update, populated
  // Collection on every read path" reasoning as RankCordSegment/
  // toRankResponseDto - see EventsService.buildResponse's own comment.
  scheduleDays: EventScheduleDay[];
}

export function toEventScheduleDayResponseDto(
  day: EventScheduleDay,
): EventScheduleDayResponseDto {
  return {
    startsAt: day.startsAt.toISOString(),
    endsAt: day.endsAt.toISOString(),
  };
}

function toSortedEventScheduleDayDtos(
  days: EventScheduleDay[],
): EventScheduleDayResponseDto[] {
  return [...days]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map(toEventScheduleDayResponseDto);
}

// Whether startsAt/endsAt fall on different calendar days, in UTC. Never
// stored (see event.entity.ts) - always derived here from the two
// timestamps. A boundary case (e.g. 23:00-01:00 in a non-UTC local time
// zone landing on the same UTC day) can disagree with the organizer's own
// local-time intuition - Event has no per-record time zone field (unlike
// Section.timezone, or the organizer User's own timezone), so there is no
// better reference frame available today; flagged as a known limitation,
// not a bug.
function computeIsMultiDay(startsAt: Date, endsAt: Date): boolean {
  return (
    startsAt.toISOString().slice(0, 10) !== endsAt.toISOString().slice(0, 10)
  );
}

export function toEventResponseDto(
  event: Event,
  context: EventAggregateContext,
  urlBuilder: PublicUrlBuilder,
): EventResponseDto {
  return {
    id: event.id,
    organizer: toEventOrganizerRefDto(event, urlBuilder),
    community: toEventCommunityRefDto(eventCommunity(event), urlBuilder),
    createdByUserId: event.createdBy?.id ?? null,
    type: event.type,
    customTypeLabel: event.customTypeLabel,
    name: event.name,
    description: event.description,
    // Prefers the R2 public URL derived from coverImageKey over the legacy
    // coverImageUrl column once an upload exists - see
    // storage/image-url.util.ts's resolveImageUrl.
    coverImageUrl: resolveImageUrl(
      event.coverImageKey,
      event.coverImageUrl,
      urlBuilder,
    ),
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    isMultiDay: computeIsMultiDay(event.startsAt, event.endsAt),
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    scheduleDays: toSortedEventScheduleDayDtos(context.scheduleDays),
    visibility: event.visibility,
    status: event.status,
    capacity: event.capacity,
    waitlistPolicy: event.waitlistPolicy,
    participantsVisibility: event.participantsVisibility,
    seatsTaken: context.seatsTaken,
    seatsAvailable: context.seatsAvailable,
    waitlistCount: context.waitlistCount,
    publicCode: event.publicCode,
    numericCode: event.numericCode,
    qrPayload: buildEventQrPayload(event.type, event.numericCode),
    viewerRoles: context.viewerRoles,
    capabilities: context.capabilities,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
