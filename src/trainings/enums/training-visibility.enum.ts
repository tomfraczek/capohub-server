// Who may see a Training at all - also who may RSVP to it: PUBLIC alone is
// sufficient for a non-member to RSVP too, there is no separate opt-in
// (module: "skoro publiczna to mogą się zapisywać osoby spoza sekcji" - see
// TrainingAccessService.canRsvp and the module spec §5). Deliberately a
// two-value enum, not Event's three-value EventVisibility: Training has no
// INVITE_ONLY concept.
export enum TrainingVisibility {
  MEMBERS_ONLY = 'MEMBERS_ONLY',
  PUBLIC = 'PUBLIC',
}
