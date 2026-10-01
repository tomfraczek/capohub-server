import { EventAttendee } from '../entities/event-attendee.entity';
import { Event } from '../entities/event.entity';
import { EventAttendeeSubjectType } from '../enums/event-attendee-subject-type.enum';
import { EventRsvpStatus } from '../enums/event-rsvp-status.enum';
import { User } from '../../users/entities/user.entity';
import {
  toEventAttendeeResponseDto,
  toEventParticipantResponseDto,
} from './event-attendee.mapper';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.displayName = 'Ana';
  user.firstName = 'Ana';
  user.lastName = 'Silva';
  user.birthDate = new Date('1995-07-01');
  user.phoneNumber = '+48 600 100 200';
  Object.assign(user, overrides);
  return user;
}

function buildAttendee(overrides: Partial<EventAttendee> = {}): EventAttendee {
  const attendee = new EventAttendee();
  attendee.id = 'attendee-1';
  attendee.event = { id: 'event-1' } as Event;
  attendee.registeredBy = buildUser();
  attendee.subjectType = EventAttendeeSubjectType.SELF;
  attendee.subjectUser = buildUser();
  attendee.rsvpStatus = EventRsvpStatus.GOING;
  attendee.registeredAt = new Date('2026-09-01T10:00:00.000Z');
  Object.assign(attendee, overrides);
  return attendee;
}

describe('event-attendee.mapper', () => {
  it('never includes personal data on the plain attendee DTO', () => {
    expect(toEventAttendeeResponseDto(buildAttendee())).not.toHaveProperty(
      'personalData',
    );
  });

  it("includes the subject user's personal data on the staff participant DTO", () => {
    expect(toEventParticipantResponseDto(buildAttendee()).personalData).toEqual(
      {
        firstName: 'Ana',
        lastName: 'Silva',
        birthDate: '1995-07-01',
        phoneNumber: '+48 600 100 200',
      },
    );
  });

  it('returns null personal data for a CHILD_DEPENDENT with no user account', () => {
    const dto = toEventParticipantResponseDto(
      buildAttendee({
        subjectType: EventAttendeeSubjectType.CHILD_DEPENDENT,
        subjectUser: null,
        dependentDisplayName: 'Kid',
      }),
    );
    expect(dto.personalData).toBeNull();
  });
});
