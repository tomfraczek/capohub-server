import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from './entities/user.entity';
import { UserDiscoveryLocation } from './entities/user-discovery-location.entity';
import { SetUserDiscoveryLocationInput } from './dto/set-user-discovery-location.schema';
import { UserDiscoveryLocationResponseDto } from './dto/user-discovery-location-response.dto';

// Owns the caller's own discovery location (see
// user-discovery-location.entity.ts's own comment for what this is and why
// it is not the public-profile city/country field). One row per User - set()
// always upserts in place, never accumulates history.
@Injectable()
export class UserLocationService {
  constructor(private readonly em: EntityManager) {}

  async getOwn(user: User): Promise<UserDiscoveryLocationResponseDto | null> {
    const location = await this.em.findOne(UserDiscoveryLocation, {
      user: user.id,
    });
    return location ? toResponseDto(location) : null;
  }

  /**
   * Idempotent full-replace - a second call with the same input is a no-op
   * write (still returns the current row). No partial-PATCH variant: a
   * location is one internally-consistent place, never edited field-by-field
   * (same reasoning as update-section.schema.ts's own full-replace
   * convention).
   */
  async setOwn(
    user: User,
    input: SetUserDiscoveryLocationInput,
  ): Promise<UserDiscoveryLocationResponseDto> {
    let location = await this.em.findOne(UserDiscoveryLocation, {
      user: user.id,
    });
    if (!location) {
      location = new UserDiscoveryLocation();
      location.user = user;
      this.em.persist(location);
    }
    location.city = input.city;
    location.region = input.region;
    location.countryCode = input.countryCode;
    location.latitude = input.latitude;
    location.longitude = input.longitude;
    location.displayName = input.displayName;
    location.source = input.source;
    await this.em.flush();
    return toResponseDto(location);
  }

  /** Idempotent - removing an already-absent location is a success, not a 404. */
  async deleteOwn(user: User): Promise<void> {
    const location = await this.em.findOne(UserDiscoveryLocation, {
      user: user.id,
    });
    if (location) {
      await this.em.removeAndFlush(location);
    }
  }
}

function toResponseDto(
  location: UserDiscoveryLocation,
): UserDiscoveryLocationResponseDto {
  return {
    city: location.city,
    region: location.region,
    countryCode: location.countryCode,
    latitude: location.latitude,
    longitude: location.longitude,
    displayName: location.displayName,
    source: location.source,
    updatedAt: location.updatedAt.toISOString(),
  };
}
