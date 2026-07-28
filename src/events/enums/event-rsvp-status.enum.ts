// Freely changeable, any number of times, by whoever controls the
// EventAttendee row (spec: "Użytkownik może dowolnie zmieniać decyzję...
// Dowolną liczbę razy"). NOT_GOING still leaves the row in place (never
// deleted) and, if the attendee held a capacity seat, frees it for
// waitlist promotion - see EventRsvpService.
export enum EventRsvpStatus {
  GOING = 'GOING',
  MAYBE = 'MAYBE',
  NOT_GOING = 'NOT_GOING',
}
