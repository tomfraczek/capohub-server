import { createEventSchema } from './create-event.schema';
import { EventType } from '../enums/event-type.enum';
import { EventVisibility } from '../enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../enums/event-waitlist-policy.enum';

const VALID_INPUT = {
  type: EventType.WORKSHOP,
  customTypeLabel: null,
  name: 'Roda de Sábado',
  description: null,
  coverImageUrl: null,
  startsAt: '2026-02-01T10:00:00.000Z',
  endsAt: '2026-02-01T18:00:00.000Z',
  locationName: null,
  locationAddress: null,
  latitude: null,
  longitude: null,
  visibility: EventVisibility.PUBLIC,
  capacity: null,
  waitlistPolicy: EventWaitlistPolicy.NONE,
};

describe('createEventSchema', () => {
  // Organizer identity is never a client-supplied field, for any of the
  // three create entry points (see events.controller.ts /
  // my-events.controller.ts): POST groups/:groupId/events and
  // POST sections/:sectionId/events take the organizer from the route
  // param, POST /events always uses the authenticated caller
  // (EventsService.createPersonal). This schema has no organizer-identity
  // field at all, so even a client that sends one gets it silently
  // stripped before the service ever sees it - there is no way to
  // "impersonate" a different User/Group/Section as organizer via the
  // request body.
  it('strips an organizerUserId/organizerType the client attempts to send', () => {
    const parsed = createEventSchema.parse({
      ...VALID_INPUT,
      organizerUserId: 'someone-elses-user-id',
      organizerType: 'USER',
    });

    expect(parsed).not.toHaveProperty('organizerUserId');
    expect(parsed).not.toHaveProperty('organizerType');
  });

  it('parses a valid, minimal payload unchanged', () => {
    const parsed = createEventSchema.parse(VALID_INPUT);

    expect(parsed.name).toBe('Roda de Sábado');
    expect(parsed.visibility).toBe(EventVisibility.PUBLIC);
  });
});
