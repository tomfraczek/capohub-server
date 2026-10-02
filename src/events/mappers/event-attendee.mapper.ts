import {
  PublicUrlBuilder,
  resolveUserAvatarUrl,
} from '../../storage/image-url.util';
import { EventAttendeeResponseDto } from '../dto/event-attendee-response.dto';
import { EventPublicAttendeeDto } from '../dto/event-public-attendee.dto';
import {
  EventParticipantPersonalDataDto,
  EventParticipantResponseDto,
} from '../dto/event-participant-response.dto';
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

// MikroORM's postgres driver returns a `date` column as a plain
// "YYYY-MM-DD" string at runtime despite the entity's Date type - same
// normalization as user-profile.mapper.ts's toDateOnly.
function toDateOnly(date: Date | string | null): string | null {
  if (!date) {
    return null;
  }
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}

function toPersonalDataDto(
  attendee: EventAttendee,
): EventParticipantPersonalDataDto | null {
  const user = attendee.subjectUser;
  if (!user) {
    return null;
  }
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    birthDate: toDateOnly(user.birthDate),
    phoneNumber: user.phoneNumber,
    gender: user.gender,
  };
}

// Staff-only variant - see EventParticipantResponseDto.
export function toEventParticipantResponseDto(
  attendee: EventAttendee,
  guardianUserId: string | null = null,
): EventParticipantResponseDto {
  return {
    ...toEventAttendeeResponseDto(attendee, guardianUserId),
    personalData: toPersonalDataDto(attendee),
  };
}

// Requires `subjectUser` populated and non-null - listPublicAttendees only
// ever passes SELF attendees.
export function toEventPublicAttendeeDto(
  attendee: EventAttendee,
  urlBuilder: PublicUrlBuilder,
): EventPublicAttendeeDto {
  const user = attendee.subjectUser!;
  return {
    id: attendee.id,
    user: {
      id: user.id,
      displayName: user.displayName,
      image: {
        type: user.avatarType,
        url: resolveUserAvatarUrl(user, urlBuilder),
        presetAvatarId: user.presetAvatarId,
      },
    },
    rsvpStatus: attendee.rsvpStatus,
  };
}
