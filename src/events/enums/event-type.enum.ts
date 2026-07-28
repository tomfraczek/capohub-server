// The fixed catalog of Event kinds named by the product spec, plus CUSTOM
// for anything else - Event.customTypeLabel carries the free-text label
// only when type === CUSTOM (see event.entity.ts).
export enum EventType {
  BATIZADO = 'BATIZADO',
  WORKSHOP = 'WORKSHOP',
  SEMINAR = 'SEMINAR',
  RODA = 'RODA',
  SHOW = 'SHOW',
  TRIP = 'TRIP',
  MEETING = 'MEETING',
  OPEN_TRAINING = 'OPEN_TRAINING',
  CUSTOM = 'CUSTOM',
}
