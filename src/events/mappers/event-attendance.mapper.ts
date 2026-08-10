import { EventAttendeeSubjectType } from '../enums/event-attendee-subject-type.enum';
import { EventAttendee } from '../entities/event-attendee.entity';
import {
  EventAttendanceEntryDto,
  EventCheckInResultDto,
} from '../dto/event-attendance.dto';

// Same displayName resolution as toEventAttendeeResponseDto (see
// event-attendee.mapper.ts) - the subject User's own displayName for
// SELF/CHILD_ACCOUNT, dependentDisplayName for CHILD_DEPENDENT (no User to
// name). Kept as its own small function rather than importing that mapper,
// since this module returns a deliberately slimmer DTO (module spec §9) and
// has no other field in common with it.
function resolveAttendeeDisplayName(attendee: EventAttendee): string {
  return attendee.subjectType === EventAttendeeSubjectType.CHILD_DEPENDENT
    ? (attendee.dependentDisplayName ?? '')
    : (attendee.subjectUser?.displayName ?? '');
}

export function toEventAttendanceEntryDto(
  attendee: EventAttendee,
): EventAttendanceEntryDto {
  return {
    attendeeId: attendee.id,
    user: {
      id: attendee.subjectUser?.id ?? null,
      displayName: resolveAttendeeDisplayName(attendee),
    },
    rsvpStatus: attendee.rsvpStatus,
    attended: attendee.checkedIn,
    recordedAt: attendee.checkedInAt?.toISOString() ?? null,
  };
}

export function toEventCheckInResultDto(
  attendee: EventAttendee,
  alreadyCheckedIn: boolean,
): EventCheckInResultDto {
  return {
    user: {
      id: attendee.subjectUser?.id ?? null,
      displayName: resolveAttendeeDisplayName(attendee),
    },
    attended: true,
    // Set unconditionally by EventAttendanceService before this mapper
    // runs (module spec §4/§8) - never null on this response shape.
    recordedAt: attendee.checkedInAt!.toISOString(),
    alreadyCheckedIn,
  };
}
