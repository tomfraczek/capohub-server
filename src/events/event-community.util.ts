import { Section } from '../groups/entities/section.entity';
import { Community } from '../groups/group-hierarchy.service';
import { User } from '../users/entities/user.entity';
import { Event } from './entities/event.entity';
import { EventOrganizerType } from './enums/event-organizer-type.enum';

// Event's public organizer identity is one of three mutually-exclusive
// things (see event.entity.ts's events_organizer_check): a Group, a
// Section, or a User organizing the Event directly.
//
// `eventCommunity()` below answers only "which Group/Section does this
// Event belong to, if any" - it returns null for a User-organized Event
// rather than ever being coerced into treating that User as a Community.
// Every community-scoped check (membership, visibility, listing,
// permission overrides) must go through this and handle null explicitly -
// see EventAccessService.isVisibleToViewer, EventsService.buildResponse,
// EventRolesService.grantRole/transferOwnership,
// EventPermissionsGuard.canActivate. Do not invent a synthetic Community
// for a User organizer to satisfy these checks (module decision: "Nie
// twórz sztucznego community dla Usera") - a User-organized Event simply
// has no Community, and callers must treat "no Community" as its own,
// valid case.
//
// For the full three-way public organizer identity (including the User
// case), see toEventOrganizerRefDto in
// mappers/event-organizer-ref.mapper.ts.
export function eventCommunity(event: Event): Community | null {
  return event.communityGroup ?? event.communitySection ?? null;
}

// Assigns Event.organizerType/communityGroup/communitySection (mutually
// exclusive) and clears organizerUser/organizerUserDisplayName - the
// Group/Section counterpart to assignEventOrganizerUser below. Only ever
// called once, at creation (see EventsService.create) - the public
// organizer is immutable afterwards (see event.entity.ts's class comment;
// UpdateEventInput structurally has no organizer-related field at all -
// see update-event.schema.ts).
export function assignEventCommunity(event: Event, community: Community): void {
  if (community instanceof Section) {
    event.organizerType = EventOrganizerType.SECTION;
    event.communitySection = community;
    event.communityGroup = null;
  } else {
    event.organizerType = EventOrganizerType.GROUP;
    event.communityGroup = community;
    event.communitySection = null;
  }
  event.organizerUser = null;
  event.organizerUserDisplayName = null;
}

// Assigns Event.organizerType/organizerUser and clears communityGroup/
// communitySection - the User counterpart to assignEventCommunity above.
// Only ever called once, at creation (see EventsService.createPersonal) -
// never reachable from update, same immutability guarantee as
// assignEventCommunity. Also takes the organizer name snapshot
// (organizerUserDisplayName) at this exact moment - see event.entity.ts's
// own comment on why that snapshot, not this FK, is what
// events_organizer_identity_check actually requires: `user` may later be
// deleted (organizerUser goes null - see
// EventsService.closeOrganizedEventsForAccountDeletion), but this Event
// must stay identifiable as USER-organized, by this name, regardless.
export function assignEventOrganizerUser(event: Event, user: User): void {
  event.organizerType = EventOrganizerType.USER;
  event.organizerUser = user;
  event.organizerUserDisplayName = user.displayName;
  event.communityGroup = null;
  event.communitySection = null;
}
