import { EventRole } from '../enums/event-role.enum';
import { EventStatus } from '../enums/event-status.enum';
import { EventType } from '../enums/event-type.enum';
import { EventVisibility } from '../enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../enums/event-waitlist-policy.enum';
import { EventParticipantsVisibility } from '../enums/event-participants-visibility.enum';
import { EventCapabilitiesDto } from './event-capabilities.dto';
import { EventCommunityRefDto } from './event-community-ref.dto';
import { EventOrganizerRefDto } from './event-organizer-ref.dto';

// See EventScheduleDay's own comment.
export interface EventScheduleDayResponseDto {
  startsAt: string;
  endsAt: string;
}

// Used for both the list endpoint and the detail endpoint - Events, like
// Academy/Cohort, has no separate "summary" shape (see academy-response.dto.ts).
export interface EventResponseDto {
  id: string;
  // The single, always-present public organizer identity (USER/GROUP/
  // SECTION) - see event-organizer-ref.dto.ts. Prefer this over
  // `community` below for anything organizer-facing (name, avatar) - the
  // frontend should never need a second request just to resolve who is
  // organizing this Event.
  organizer: EventOrganizerRefDto;
  // Kept for backward compatibility and existing Group/Section navigation
  // flows (see event-community-ref.mapper.ts) - null exactly when
  // `organizer.type === 'USER'`, since a User-organized Event belongs to
  // no Group/Section (see event-community.util.ts).
  community: EventCommunityRefDto | null;
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
  // Optional per-day breakdown of startsAt/endsAt (module: "w piątek
  // wydarzenie trwa do 18, w sobotę... jak to ugryźć?") - `[]` for the
  // common single-day Event, always sorted ascending by startsAt. Purely
  // descriptive: RSVP/capacity/waitlist/notifications still only ever look
  // at startsAt/endsAt above, never at this.
  scheduleDays: EventScheduleDayResponseDto[];
  visibility: EventVisibility;
  status: EventStatus;
  capacity: number | null;
  waitlistPolicy: EventWaitlistPolicy;
  participantsVisibility: EventParticipantsVisibility;
  // Non-waitlisted attendees with rsvpStatus GOING or MAYBE - i.e. seats
  // currently claimed against `capacity`.
  seatsTaken: number;
  // null when capacity is null (no limit).
  seatsAvailable: number | null;
  waitlistCount: number;
  publicCode: string | null;
  // Stable 6-digit code, unique within this Event's own `type` (see
  // entities/event.entity.ts) - not a secret.
  numericCode: string;
  // "capohub:v1:<f|w|r|e>:<numericCode>" (one letter per EventType - see
  // common/identity/qr-payload.util.ts) - the exact string the frontend
  // encodes as this Event's QR identity.
  qrPayload: string;
  // The caller's own Event roles for this Event - [] if none. Never used
  // by the frontend to derive `capabilities` itself - see
  // event-capabilities.dto.ts.
  viewerRoles: EventRole[];
  capabilities: EventCapabilitiesDto;
  createdAt: string;
  updatedAt: string;
}
