// The fixed catalog of Event kinds. Immutable once an Event is created -
// CREATE requires one of these four values, UPDATE never accepts `type` at
// all (see create-event.schema.ts / update-event.schema.ts /
// EventsService.update). Batizado/Troca de Corda are program elements of a
// FESTIVAL, not their own EventType - there is deliberately no dedicated
// value for them (see the EventType cleanup report).
export enum EventType {
  FESTIVAL = 'FESTIVAL',
  WORKSHOP = 'WORKSHOP',
  OPEN_RODA = 'OPEN_RODA',
  // Free-text kind - the only value where Event.customTypeLabel carries a
  // label (see event.entity.ts).
  OTHER = 'OTHER',
}
