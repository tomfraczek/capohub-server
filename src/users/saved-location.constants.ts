// Deliberately not imported from groups/community-overview.constants.ts -
// that value bounds a single nearby-search request; this one bounds what a
// SavedLocation record may store. They happen to agree today, but coupling
// the two modules over one shared number is not worth avoiding a duplicate
// constant (GroupsModule must never import UsersModule back, and the
// reverse here would be equally unnecessary - see users.module.ts's own
// comment on the module boundary).
export const DEFAULT_SAVED_LOCATION_RADIUS_KM = 50;
export const MAX_SAVED_LOCATION_RADIUS_KM = 300;
