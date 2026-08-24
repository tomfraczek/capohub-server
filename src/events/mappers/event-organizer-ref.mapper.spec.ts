import { Group } from '../../groups/entities/group.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import { AvatarType } from '../../users/enums/avatar-type.enum';
import { Event } from '../entities/event.entity';
import { EventOrganizerType } from '../enums/event-organizer-type.enum';
import { toEventOrganizerRefDto } from './event-organizer-ref.mapper';

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  return Object.assign(event, overrides);
}

describe('toEventOrganizerRefDto', () => {
  it('resolves a GROUP organizer from communityGroup', () => {
    const event = buildEvent({ organizerType: EventOrganizerType.GROUP });
    event.communityGroup = Object.assign(new Group(), {
      id: 'group-1',
      name: 'Capoeira Brasil Polska',
      logoUrl: 'https://cdn.example.com/logos/cbp.png',
    });

    expect(toEventOrganizerRefDto(event)).toEqual({
      type: 'GROUP',
      id: 'group-1',
      name: 'Capoeira Brasil Polska',
      image: { url: 'https://cdn.example.com/logos/cbp.png' },
    });
  });

  it('resolves a SECTION organizer from communitySection', () => {
    const event = buildEvent({ organizerType: EventOrganizerType.SECTION });
    event.communitySection = Object.assign(new Section(), {
      id: 'section-1',
      name: 'Capoeira Brasil Poznań',
      logoUrl: null,
    });

    expect(toEventOrganizerRefDto(event)).toEqual({
      type: 'SECTION',
      id: 'section-1',
      name: 'Capoeira Brasil Poznań',
      image: { url: null },
    });
  });

  it('resolves an active USER organizer from organizerUser, carrying the full avatar shape', () => {
    const event = buildEvent({ organizerType: EventOrganizerType.USER });
    event.organizerUserDisplayName = 'Mestre Acordeon';
    event.organizerUser = Object.assign(new User(), {
      id: 'user-1',
      displayName: 'Mestre Acordeon',
      avatarType: AvatarType.UPLOAD,
      avatarUrl: 'https://cdn.example.com/avatars/mestre.png',
      presetAvatarId: null,
    });

    expect(toEventOrganizerRefDto(event)).toEqual({
      type: 'USER',
      id: 'user-1',
      name: 'Mestre Acordeon',
      image: {
        type: AvatarType.UPLOAD,
        url: 'https://cdn.example.com/avatars/mestre.png',
        presetAvatarId: null,
      },
    });
  });

  it('carries a PRESET avatar with a null url and a non-null presetAvatarId', () => {
    const event = buildEvent({ organizerType: EventOrganizerType.USER });
    event.organizerUserDisplayName = 'Mestre Acordeon';
    event.organizerUser = Object.assign(new User(), {
      id: 'user-1',
      displayName: 'Mestre Acordeon',
      avatarType: AvatarType.PRESET,
      avatarUrl: null,
      presetAvatarId: 'preset-07',
    });

    expect(toEventOrganizerRefDto(event).image).toEqual({
      type: AvatarType.PRESET,
      url: null,
      presetAvatarId: 'preset-07',
    });
  });

  it('falls back to the display-name snapshot, with a null id and null image, once organizerUser has been deleted', () => {
    // organizerUser is ON DELETE SET NULL (see event.entity.ts) - the
    // Event stays USER-organized via organizerType/organizerUserDisplayName
    // regardless of whether the account still exists.
    const event = buildEvent({
      organizerType: EventOrganizerType.USER,
      organizerUser: null,
      organizerUserDisplayName: 'Mestre Acordeon',
    });

    expect(toEventOrganizerRefDto(event)).toEqual({
      type: 'USER',
      id: null,
      name: 'Mestre Acordeon',
      image: null,
    });
  });

  it('never renders a deleted organizer as a clickable active profile (id/image both null, never a stale id)', () => {
    const event = buildEvent({
      organizerType: EventOrganizerType.USER,
      organizerUser: null,
      organizerUserDisplayName: 'Ada Lovelace',
    });

    const dto = toEventOrganizerRefDto(event);

    expect(dto.id).toBeNull();
    expect(dto.image).toBeNull();
  });
});
