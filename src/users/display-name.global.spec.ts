import { Event } from '../events/entities/event.entity';
import { EventAttendee } from '../events/entities/event-attendee.entity';
import { EventOrganizerType } from '../events/enums/event-organizer-type.enum';
import { toEventOrganizerRefDto } from '../events/mappers/event-organizer-ref.mapper';
import { toEventPublicAttendeeDto } from '../events/mappers/event-attendee.mapper';
import { RecipientGroup } from '../groups/entities/recipient-group.entity';
import { toRecipientGroupResponseDto } from '../groups/mappers/recipient-group.mapper';
import { toSongUserRefDto } from '../songs/mappers/song.mapper';
import { PublicUrlBuilder } from '../storage/image-url.util';
import { TrainingRsvp } from '../trainings/entities/training-rsvp.entity';
import { toTrainingRsvpResponseDto } from '../trainings/mappers/training-rsvp.mapper';
import { User } from './entities/user.entity';
import { DisplayNameMode } from './enums/display-name-mode.enum';

const urlBuilder: PublicUrlBuilder = {
  buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
};

// The same person, seen from several unrelated modules: every surface that
// presents a user to others must agree, because they all go through
// resolveDisplayName - never User.displayName (the email-seeded account
// label, deliberately set to something else here to catch a regression).
function buildUser(mode: DisplayNameMode): User {
  return Object.assign(new User(), {
    id: 'user-1',
    displayName: 'tomasz.fr90',
    firstName: 'Tomasz',
    lastName: 'Frączek',
    apelido: 'Lagarto',
    publicCode: 'U000001',
    currentRankTitle: 'Graduado',
    displayNameMode: mode,
  });
}

function namesAcrossTheApp(user: User): string[] {
  const event = Object.assign(new Event(), {
    organizerType: EventOrganizerType.USER,
    organizerUser: user,
    organizerUserDisplayName: 'snapshot',
  });
  const attendee = Object.assign(new EventAttendee(), {
    id: 'attendee-1',
    subjectUser: user,
  });
  const recipientGroup = Object.assign(new RecipientGroup(), {
    id: 'recipient-group-1',
    group: { id: 'group-1' },
    section: null,
    name: 'Grupa',
    isActive: true,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const rsvp = Object.assign(new TrainingRsvp(), {
    id: 'rsvp-1',
    training: { id: 'training-1' },
    user,
    respondedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  return [
    toSongUserRefDto(user)!.displayName,
    toEventOrganizerRefDto(event, urlBuilder).name,
    toEventPublicAttendeeDto(attendee, urlBuilder).user.displayName,
    toRecipientGroupResponseDto(recipientGroup, [user]).members[0].displayName,
    toTrainingRsvpResponseDto(rsvp).user.displayName,
  ];
}

describe('display name - applied consistently across modules', () => {
  it('shows "Tytuł i apelido" everywhere for a user who chose it', () => {
    const names = namesAcrossTheApp(buildUser(DisplayNameMode.TITLE_APELIDO));
    expect(new Set(names)).toEqual(new Set(['Graduado Lagarto']));
  });

  it('shows the full name everywhere for a user on the default mode', () => {
    const names = namesAcrossTheApp(buildUser(DisplayNameMode.FULL_NAME));
    expect(new Set(names)).toEqual(new Set(['Tomasz Frączek']));
  });
});
