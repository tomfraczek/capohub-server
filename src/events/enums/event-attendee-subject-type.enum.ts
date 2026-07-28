// Who an EventAttendee row actually represents - see event-attendee.entity.ts
// and children-directory.port.ts for why CHILD_ACCOUNT and CHILD_DEPENDENT
// are modeled so differently despite both being "a child".
export enum EventAttendeeSubjectType {
  // The registering User themselves.
  SELF = 'SELF',
  // A child who already has their own app account (subjectUser is that
  // other, real User row).
  CHILD_ACCOUNT = 'CHILD_ACCOUNT',
  // A child with no app account - captured as free-text
  // (dependentDisplayName) scoped only to this one registration, since no
  // reusable dependent-profile entity exists yet (see
  // children-directory.port.ts).
  CHILD_DEPENDENT = 'CHILD_DEPENDENT',
}
