import { AvatarType } from '../../users/enums/avatar-type.enum';
import { EventRsvpStatus } from '../enums/event-rsvp-status.enum';

// Mirrors User.avatarType/avatarUrl/presetAvatarId - same shape as
// EventOrganizerUserImageDto (a PRESET avatar has no URL; the app resolves
// presetAvatarId to a local asset).
export interface EventPublicAttendeeImageDto {
  type: AvatarType;
  url: string | null;
  presetAvatarId: string | null;
}

// One row of GET events/:eventId/attendees - the participant list shown on
// Event Details to anyone allowed to see it (see
// EventCapabilitiesDto.canViewParticipants). Deliberately minimal, unlike
// the staff-only EventParticipantResponseDto: public identity only (never
// personal data, check-in or waitlist detail), and only adult SELF
// registrations - a child attendee's name is never exposed to other
// participants.
export interface EventPublicAttendeeDto {
  // EventAttendee id.
  id: string;
  user: {
    id: string;
    displayName: string;
    image: EventPublicAttendeeImageDto;
  };
  // GOING or MAYBE only - NOT_GOING and waitlisted attendees hold no seat
  // and are not listed.
  rsvpStatus: EventRsvpStatus;
}
