// Explicit discriminator for Event's public organizer identity - added
// alongside the three organizer FKs (communityGroup/communitySection/
// organizerUser, see event.entity.ts) so a User-organized Event stays
// unambiguously identifiable as USER even after organizerUser has been set
// to null (see UserService.deleteLocalAccountData / the module: "USER
// organizer - zachowanie historii"). Without this, an Event whose
// organizerUser went null would be structurally indistinguishable from
// "no organizer set at all", which the original 3-way CHECK (communityGroup/
// communitySection/organizerUser - exactly one non-null) could never
// tolerate.
export enum EventOrganizerType {
  USER = 'USER',
  GROUP = 'GROUP',
  SECTION = 'SECTION',
}
