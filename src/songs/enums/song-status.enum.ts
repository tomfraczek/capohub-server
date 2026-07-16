// Lifecycle state of a Song. Transitions between these values are not
// implemented yet - see Etap 8.3 (moderation).
export enum SongStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  PUBLISHED = 'PUBLISHED',
  REJECTED = 'REJECTED',
  HIDDEN = 'HIDDEN',
}
