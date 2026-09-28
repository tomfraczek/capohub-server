import { Entity, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from './user.entity';

// A User-approved, named place used for nearby-community discovery (see
// CommunityOverviewService/GroupsModule) and, later, location-scoped
// notifications (see `notificationsEnabled` below). Replaces the old
// UserDiscoveryLocation (one row per user) - a user may now have many of
// these, switched between via a client-
// side "active location" concept (device GPS or one specific
// SavedLocation) that this entity deliberately knows nothing about: no
// `isActive`/`isDefault` flag lives here, since "which one is active" is a
// per-device UI preference, not a fact about the location itself (module:
// "Nie dodawaj pola activeLocation do backendowego User").
// Remains deliberately narrower in scope than a general "location" concept:
//  - Private: never rendered on any public profile endpoint (module: "NIE
//    powinna być publicznie eksponowana w jego profilu").
//  - Precise: carries latitude/longitude, needed to compute an actual
//    distance to a Section (see Section.latitude/longitude).
//  - User-set, not GPS-tracked: created only through POST
//    /users/me/locations (see SavedLocationsService) when the user
//    explicitly confirms a place via search - a live device GPS reading is
//    never itself persisted as a SavedLocation (module: "DeviceLocation
//    jest tymczasowe... NIE zapisuj jako SavedLocation").
@Entity({ tableName: 'saved_locations' })
export class SavedLocation extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // User-editable label (e.g. "Dom", "Praca") - defaults to `city` on
  // display when unset (see the response mapper), never generated or
  // required server-side. Changing it never touches latitude/longitude -
  // to move to an actually different place, the caller creates a new
  // SavedLocation via search instead (module: "Zmiana nazwy nie może
  // zmieniać latitude/longitude").
  @Property({ nullable: true, length: 100 })
  name: string | null = null;

  // city/region/countryCode are the structured place data the search
  // picker returned (see PlaceSearchResultDto) - display-only, never
  // required (nullable so a hand-migrated or otherwise incomplete row is
  // still valid; module: "NIE generuj fikcyjnego miasta... name/city może
  // być nullable"). Not cross-checked against the GeoNames dataset here,
  // same as the old UserDiscoveryLocation.
  @Property({ nullable: true, length: 100 })
  city: string | null = null;

  @Property({ nullable: true, length: 100 })
  region: string | null = null;

  // ISO 3166-1 alpha-2, uppercase - same convention as Section.country.
  @Property({ nullable: true, length: 2 })
  countryCode: string | null = null;

  @Property({ type: 'float' })
  latitude!: number;

  @Property({ type: 'float' })
  longitude!: number;

  // Deliberately no search radius here - a SavedLocation only answers
  // "where". How far to search from it is a per-search filter sent with
  // each nearby/home request (`?radiusKm=`, see community-overview-query.
  // schema.ts), the same for a SavedLocation as for device GPS.

  // Prepares this model for a future "notify me about activity near this
  // saved place, independent of whichever location is currently active"
  // feature (module §16) - not read by any nearby-discovery or
  // notification-delivery code yet, and deliberately not surfaced as a
  // toggle in the mobile UI until that feature actually ships (module:
  // "Nie twórz w UI martwego przełącznika, który niczego nie robi").
  @Property()
  notificationsEnabled = false;
}
