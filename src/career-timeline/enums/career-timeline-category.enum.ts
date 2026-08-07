// Stable, frontend-facing categories for career-timeline items (see the
// module spec). Colors/legend/iconography for each category are a frontend
// concern - deliberately not modeled here.
export enum CareerTimelineCategory {
  CAPOEIRA_START = 'CAPOEIRA_START',
  FORMAL_GROUP_JOINED = 'FORMAL_GROUP_JOINED',
  FORMAL_GROUP_LEFT = 'FORMAL_GROUP_LEFT',
  FORMAL_RANK = 'FORMAL_RANK',
  EVENT = 'EVENT',
  CUSTOM = 'CUSTOM',
}
