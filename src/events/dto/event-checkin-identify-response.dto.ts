import { GroupUserRefDto } from '../../groups/dto/group-user-ref.dto';
import { EventAttendeeResponseDto } from './event-attendee-response.dto';

// Response to scanning/looking up a check-in code (spec: "Po zeskanowaniu
// backend identyfikuje użytkownika... Jeżeli użytkownik jest opiekunem
// dzieci na tym Evencie, backend zwraca również dzieci będące pod jego
// opieką"). `selfAttendee` is null if the scanned user never registered
// themselves for this Event (they may still be a guardian for others -
// spec: guardians need not be participants).
export interface EventCheckInIdentifyResponseDto {
  user: GroupUserRefDto;
  selfAttendee: EventAttendeeResponseDto | null;
  // Children this user is the *active* guardian for, on this Event -
  // see EventGuardianAssignment.
  childrenUnderGuardianship: EventAttendeeResponseDto[];
}
