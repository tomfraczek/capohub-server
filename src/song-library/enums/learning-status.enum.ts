// Per-user tracking of how well they know a given Song - entirely local to
// CapoHub, has no effect on the global Song model (see UserSongLearning).
export enum LearningStatus {
  NOT_STARTED = 'NOT_STARTED',
  LEARNING = 'LEARNING',
  TO_REVIEW = 'TO_REVIEW',
  MASTERED = 'MASTERED',
  CAN_LEAD = 'CAN_LEAD',
}
