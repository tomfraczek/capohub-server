import { UserGender } from '../../users/enums/user-gender.enum';
import { EventAttendeeResponseDto } from './event-attendee-response.dto';

// The subject User's own personal data, shown to the Event's staff so they
// can run the event (contact a participant, check age). Unfiltered by the
// user's profile privacy toggles on purpose - those govern what *other
// users* see on the public profile, not what an event's organizers see
// about someone who registered for it.
export interface EventParticipantPersonalDataDto {
  firstName: string | null;
  lastName: string | null;
  // 'YYYY-MM-DD'.
  birthDate: string | null;
  phoneNumber: string | null;
  // For inflecting Polish wording about this user - see UserGender.
  gender: UserGender | null;
}

// GET events/:eventId/participants only (EVENT_MANAGE_PARTICIPANTS - every
// EventRole: MODERATOR, ORGANIZER, OWNER). Never returned from any
// self-service endpoint (register, my-registrations, rsvp) - those keep
// the plain EventAttendeeResponseDto. `personalData` is null for a
// CHILD_DEPENDENT attendee, who has no User account to read it from.
export interface EventParticipantResponseDto extends EventAttendeeResponseDto {
  personalData: EventParticipantPersonalDataDto | null;
}
