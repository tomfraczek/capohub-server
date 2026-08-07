// A user's declared intent to attend a Training. Deliberately no
// NO_RESPONSE value - the absence of a TrainingRsvp row *is* "no response"
// (see training-rsvp.entity.ts and the module spec §6); this enum only
// names the three states a row can actually hold.
export enum TrainingRsvpStatus {
  YES = 'YES',
  NO = 'NO',
  MAYBE = 'MAYBE',
}
