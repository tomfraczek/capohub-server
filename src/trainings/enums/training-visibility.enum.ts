// Who may see a Training at all - independent of `allowExternalRsvp`, which
// separately gates whether a viewer outside the owning Section may RSVP
// (see TrainingRsvpService and the module spec §5). Deliberately a
// two-value enum, not Event's three-value EventVisibility: Training has no
// INVITE_ONLY concept.
export enum TrainingVisibility {
  MEMBERS_ONLY = 'MEMBERS_ONLY',
  PUBLIC = 'PUBLIC',
}
