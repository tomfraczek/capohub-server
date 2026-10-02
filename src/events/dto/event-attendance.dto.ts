import { UserGender } from '../../users/enums/user-gender.enum';
import { EventRsvpStatus } from '../enums/event-rsvp-status.enum';

// Safe, minimal User reference for the attendance roster - `id` is null
// only for a CHILD_DEPENDENT attendee (a child with no account of their
// own - see event-attendee.entity.ts), which the numericCode/QR check-in
// flow can never target (there is no User to resolve). Never email/phone/
// clerkUserId (module spec §9).
export interface EventAttendanceUserRefDto {
  id: string | null;
  displayName: string;
  // null for a CHILD_DEPENDENT attendee (no account) - see UserGender.
  gender: UserGender | null;
}

// One EventAttendee's attendance state - RSVP (declared intent) and
// attended (recorded fact) are reported side by side, never conflated (see
// the module spec §4). `recordedAt` is null exactly when attendance has
// never been explicitly recorded (i.e. still at its default `false` - see
// EventAttendee.checkedIn); once `recordedAt` is set, `attended` is the
// real, explicit decision (true = present, false = explicitly absent) -
// three distinguishable states in total (unset / present / absent), never
// collapsed into a plain boolean (module spec §11). `attendeeId` is the
// EventAttendee row id - the frontend needs it to address a CHILD_DEPENDENT
// attendee (no `user.id` to key off), via
// PUT events/:eventId/attendance/attendees/:attendeeId.
export interface EventAttendanceEntryDto {
  attendeeId: string;
  user: EventAttendanceUserRefDto;
  rsvpStatus: EventRsvpStatus;
  attended: boolean;
  recordedAt: string | null;
}

export interface EventAttendanceRosterResponseDto {
  event: { id: string; name: string };
  items: EventAttendanceEntryDto[];
}

// POST events/:eventId/check-in response (module spec §19). `alreadyCheckedIn`
// is true exactly when this scan changed nothing (the attendee was already
// marked present) - the frontend uses it to distinguish "just checked in"
// from "already here" without treating the latter as an error (module spec
// §8: idempotent, never a conflict).
export interface EventCheckInResultDto {
  user: EventAttendanceUserRefDto;
  attended: true;
  recordedAt: string;
  alreadyCheckedIn: boolean;
}

// POST events/:eventId/attendance/identify response - a pure lookup, never
// a mutation (module spec §6: "ZERO mutacji"). `user` is whoever the scanned
// identity resolved to - not necessarily an attendee themselves (module spec
// §8: a guardian need not be registered). `selfAttendee` is null when the
// scanned User has no EventAttendee row of their own;
// `childrenUnderGuardianship` lists every CHILD_ACCOUNT/CHILD_DEPENDENT
// attendee this User is the *active* guardian for on this Event (see
// EventGuardianAssignment) - present regardless of whether `selfAttendee`
// exists, since a guardian need not be a participant. The frontend presents
// all of these as independently selectable check-in candidates - scanning
// never marks any of them present on its own.
export interface EventAttendanceIdentifyResponseDto {
  user: { id: string; displayName: string };
  selfAttendee: EventAttendanceEntryDto | null;
  childrenUnderGuardianship: EventAttendanceEntryDto[];
}
