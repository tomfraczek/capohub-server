// Who may see an Event's participant list (GET events/:eventId/attendees)
// on top of the Event's staff - independent of EventVisibility, which
// decides who may see the Event at all. Staff (any Event role) and the
// Community's event overseers (EVENT_VIEW_ALL/EVENT_MODERATE) always see
// the list regardless - see EventsService.canViewParticipants.
export enum EventParticipantsVisibility {
  // Anyone who can see the Event can also see who is going - the default
  // for a new Event.
  PUBLIC = 'PUBLIC',
  // Only the Event's staff/overseers - the behavior every Event had before
  // this setting existed (see the migration's backfill).
  PRIVATE = 'PRIVATE',
}
