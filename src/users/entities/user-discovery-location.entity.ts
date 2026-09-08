import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from './user.entity';

// A User-approved location used only for nearby-community discovery (see
// CommunityOverviewService/GroupsModule) - deliberately NOT the same thing
// as User.city/country on user.entity.ts, which is a public profile field
// (shown when showLocation is true, city/country text only, no coordinates).
// This one is:
//  - Private: never rendered on any public profile endpoint (module: "NIE
//    powinna być publicznie eksponowana w jego profilu").
//  - Precise: carries latitude/longitude, needed to compute an actual
//    distance to a Section (see Section.latitude/longitude) - the profile
//    field never did and still doesn't.
//  - User-set, not GPS-tracked: written only through PUT/DELETE
//    /users/me/discovery-location (see UserLocationService) when the user
//    explicitly confirms a place - never updated automatically from a
//    device location stream (module: "Nie potrzebujemy ciągłego śledzenia
//    GPS").
// One row per User (enforced by the unique `user` FK below) - "setting a new
// location" always replaces this single row in place, it never accumulates
// history (module: "NIE jest dokładną historią GPS użytkownika").
//
// Deliberately its own entity rather than columns bolted onto User: keeps
// this narrow, privacy-sensitive concern (and its own delete/clear
// lifecycle) independent of the User entity's already-large field set, and
// row-presence itself doubles as `location.configured` (see
// CommunityHomeResponseDto) with no extra "is this set" flag needed.
@Entity({ tableName: 'user_discovery_locations' })
export class UserDiscoveryLocation extends BaseEntity {
  @Unique()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // city/locality - free text, same convention as Section.city (not cross-
  // checked against the GeoNames dataset here: unlike Group/Section create,
  // there is no "must be a known city" business rule for a personal
  // discovery location - see set-user-discovery-location.schema.ts).
  @Property({ length: 100 })
  city!: string;

  @Property({ nullable: true, length: 100 })
  region: string | null = null;

  // ISO 3166-1 alpha-2, uppercase - same convention as Section.country/
  // User.country.
  @Property({ length: 2 })
  countryCode!: string;

  @Property({ type: 'float' })
  latitude!: number;

  @Property({ type: 'float' })
  longitude!: number;

  // Optional, safe auxiliary fields (module: "Można również przechowywać
  // bezpieczne pomocnicze pola typu displayName / source") - never required,
  // never used in distance math.
  // A human-readable label for the chosen place (e.g. "Poznań, Poland") -
  // purely a display convenience for whatever UI the client renders around
  // the location picker; never parsed back into city/region/countryCode.
  @Property({ nullable: true, length: 255 })
  displayName: string | null = null;

  // Free-form provenance tag (e.g. "manual", "device-gps", "ip") the client
  // may send to describe how this location was obtained - purely
  // informational, never validated against a fixed enum (this codebase has
  // no geocoding provider of its own yet - see this entity's class comment
  // and UserLocationService - so the set of real sources is entirely
  // client-defined for now).
  @Property({ nullable: true, length: 50 })
  source: string | null = null;
}
