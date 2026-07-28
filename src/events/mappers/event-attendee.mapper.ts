import { EventAttendeeResponseDto } from '../dto/event-attendee-response.dto';
import { EventAttendeeSubjectType } from '../enums/event-attendee-subject-type.enum';
import { EventAttendee } from '../entities/event-attendee.entity';

export function toEventAttendeeResponseDto(
  attendee: EventAttendee,
  guardianUserId: string | null = null,
): EventAttendeeResponseDto {
  const displayName =
    attendee.subjectType === EventAttendeeSubjectType.CHILD_DEPENDENT
      ? (attendee.dependentDisplayName ?? '')
      : (attendee.subjectUser?.displayName ?? '');

  return {
    id: attendee.id,
    eventId: attendee.event.id,
    registeredByUserId: attendee.registeredBy.id,
    subjectType: attendee.subjectType,
    subjectUserId: attendee.subjectUser?.id ?? null,
    displayName,
    rsvpStatus: attendee.rsvpStatus,
    registeredAt: attendee.registeredAt.toISOString(),
    isWaitlisted: attendee.isWaitlisted,
    waitlistedAt: attendee.waitlistedAt?.toISOString() ?? null,
    promotedAt: attendee.promotedAt?.toISOString() ?? null,
    checkedIn: attendee.checkedIn,
    checkedInAt: attendee.checkedInAt?.toISOString() ?? null,
    checkedInByUserId: attendee.checkedInBy?.id ?? null,
    checkInMethod: attendee.checkInMethod,
    guardianUserId,
  };
}
