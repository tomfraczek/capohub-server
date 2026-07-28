import { EventAttendeeSubjectType } from '../enums/event-attendee-subject-type.enum';
import { EventCheckInMethod } from '../enums/event-check-in-method.enum';
import { EventRsvpStatus } from '../enums/event-rsvp-status.enum';

export interface EventAttendeeResponseDto {
  id: string;
  eventId: string;
  registeredByUserId: string;
  subjectType: EventAttendeeSubjectType;
  // Set for SELF/CHILD_ACCOUNT, null for CHILD_DEPENDENT.
  subjectUserId: string | null;
  // Best-effort display name regardless of subjectType: the subject User's
  // displayName for SELF/CHILD_ACCOUNT, or dependentDisplayName for
  // CHILD_DEPENDENT - see event-attendee.mapper.ts.
  displayName: string;
  rsvpStatus: EventRsvpStatus;
  registeredAt: string;
  isWaitlisted: boolean;
  waitlistedAt: string | null;
  promotedAt: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedInByUserId: string | null;
  checkInMethod: EventCheckInMethod | null;
  // Present only when this attendee is a CHILD_ACCOUNT/CHILD_DEPENDENT and
  // has an active guardian assignment for this Event - see
  // EventGuardianAssignment. Null for SELF rows and for children with no
  // guardian currently assigned.
  guardianUserId: string | null;
}
