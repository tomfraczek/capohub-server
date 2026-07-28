// Placeholder integration seam for the not-yet-built Children/Family
// module (spec: "Projekt ma współpracować z istniejącym lub planowanym
// modułem dzieci" - Events must integrate with it, not build it itself).
// See docs/api/events-api.md "Architectural decisions" for the full
// explanation of what is, and is not, possible without it.
//
// Nothing in this codebase implements a parent -> child relationship today
// (no "child profile", no family-linking anywhere in src/users). Until a
// real Children module provides one:
//  - "list my children so I can pick who to register" cannot be offered -
//    NullChildrenDirectoryService.listChildrenOf() always resolves to [].
//  - registering a CHILD_ACCOUNT attendee (a child who already has their
//    own User account) cannot be verified as an actual parent/child
//    relationship - canRegisterChildAccount() always resolves to false,
//    so EventRsvpService.register rejects every CHILD_ACCOUNT attempt with
//    a clear CHILDREN_DIRECTORY_NOT_AVAILABLE error rather than silently
//    trusting the caller's word for it.
//  - registering a CHILD_DEPENDENT attendee (a child with no account) is
//    NOT blocked by this port - it needs no cross-checking, since the
//    display name is captured only for this one Event registration (see
//    EventAttendee.dependentDisplayName) rather than referencing any
//    reusable profile.
//
// Swapping in a real Children module later means providing a new
// implementation of this interface and rebinding CHILDREN_DIRECTORY_PORT
// in EventsModule - no change to any Events entity, service, or endpoint
// contract required.
export interface ChildRef {
  userId: string;
  displayName: string;
}

export interface ChildrenDirectoryPort {
  /**
   * Every child (with their own account) `parentUserId` is currently
   * allowed to register for an Event. Always [] until a real Children
   * module is wired in - see the module-level comment above.
   */
  listChildrenOf(parentUserId: string): Promise<ChildRef[]>;

  /**
   * Whether `parentUserId` is currently allowed to register the User
   * identified by `childUserId` as their child. Always false until a real
   * Children module is wired in - see the module-level comment above.
   */
  canRegisterChildAccount(
    parentUserId: string,
    childUserId: string,
  ): Promise<boolean>;
}

export const CHILDREN_DIRECTORY_PORT = Symbol('CHILDREN_DIRECTORY_PORT');
