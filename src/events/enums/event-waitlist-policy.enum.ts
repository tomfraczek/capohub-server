// Only meaningful when Event.capacity is set - see event.entity.ts.
export enum EventWaitlistPolicy {
  // No waitlist: once capacity is full, further registration attempts are
  // rejected outright (EVENT_FULL).
  NONE = 'NONE',
  // The earliest-waitlisted attendee is promoted automatically the moment a
  // seat is freed (someone else sets NOT_GOING) - see EventRsvpService.
  AUTOMATIC = 'AUTOMATIC',
  // Freed seats stay open until an Organizer/Moderator explicitly promotes
  // someone from the waitlist - see EVENT_MANAGE_PARTICIPANTS.
  MANUAL = 'MANUAL',
}
