// A graduation system has exactly two tracks, fixed for the whole app - not
// a per-Group configurable list. No automatic CHILD -> ADULT transition and
// no age-based enforcement (see docs/product spec for this module) - which
// track a Rank belongs to, and which track a user picks from, is entirely
// explicit.
export enum RankTrack {
  CHILD = 'CHILD',
  ADULT = 'ADULT',
}
