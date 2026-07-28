import { EventRole } from '../enums/event-role.enum';
import { EventStatus } from '../enums/event-status.enum';
import { EventType } from '../enums/event-type.enum';
import { EventVisibility } from '../enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../enums/event-waitlist-policy.enum';
import { EventCapabilitiesDto } from './event-capabilities.dto';
import { EventCommunityRefDto } from './event-community-ref.dto';

// Used for both the list endpoint and the detail endpoint - Events, like
// Academy/Section, has no separate "summary" shape (see academy-response.dto.ts).
export interface EventResponseDto {
  id: string;
  community: EventCommunityRefDto;
  createdByUserId: string | null;
  type: EventType;
  customTypeLabel: string | null;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  startsAt: string;
  endsAt: string;
  // Derived from startsAt/endsAt, never stored (see event.entity.ts).
  isMultiDay: boolean;
  locationName: string | null;
  locationAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  visibility: EventVisibility;
  status: EventStatus;
  capacity: number | null;
  waitlistPolicy: EventWaitlistPolicy;
  // Non-waitlisted attendees with rsvpStatus GOING or MAYBE - i.e. seats
  // currently claimed against `capacity`.
  seatsTaken: number;
  // null when capacity is null (no limit).
  seatsAvailable: number | null;
  waitlistCount: number;
  publicCode: string | null;
  // The caller's own Event roles for this Event - [] if none. Never used
  // by the frontend to derive `capabilities` itself - see
  // event-capabilities.dto.ts.
  viewerRoles: EventRole[];
  capabilities: EventCapabilitiesDto;
  createdAt: string;
  updatedAt: string;
}
