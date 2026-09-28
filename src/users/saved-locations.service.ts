import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CreateSavedLocationInput } from './dto/create-saved-location.schema';
import { SavedLocationResponseDto } from './dto/saved-location-response.dto';
import { UpdateSavedLocationInput } from './dto/update-saved-location.schema';
import { SavedLocation } from './entities/saved-location.entity';
import { User } from './entities/user.entity';

// Owns the caller's own SavedLocations - every method scopes its query by
// `user: user.id`, making "not mine" and "doesn't exist" indistinguishable
// to the caller, same IDOR-safe pattern as CareerTimelineEntriesService.
// Unlike the UserDiscoveryLocation it replaces, this is a real one-to-many:
// no upsert-in-place, create() always adds a new row.
@Injectable()
export class SavedLocationsService {
  constructor(private readonly em: EntityManager) {}

  async list(user: User): Promise<SavedLocationResponseDto[]> {
    const locations = await this.em.find(
      SavedLocation,
      { user: user.id },
      { orderBy: { createdAt: 'asc' } },
    );
    return locations.map(toResponseDto);
  }

  async create(
    user: User,
    input: CreateSavedLocationInput,
  ): Promise<SavedLocationResponseDto> {
    const location = new SavedLocation();
    location.user = user;
    location.name = input.name;
    location.city = input.city;
    location.region = input.region;
    location.countryCode = input.countryCode;
    location.latitude = input.latitude;
    location.longitude = input.longitude;
    await this.em.persist(location).flush();
    return toResponseDto(location);
  }

  async update(
    user: User,
    id: string,
    input: UpdateSavedLocationInput,
  ): Promise<SavedLocationResponseDto> {
    const location = await this.loadOwn(user.id, id);
    if (input.name !== undefined) {
      location.name = input.name;
    }
    await this.em.flush();
    return toResponseDto(location);
  }

  async delete(user: User, id: string): Promise<void> {
    const location = await this.loadOwn(user.id, id);
    await this.em.remove(location).flush();
  }

  private async loadOwn(userId: string, id: string): Promise<SavedLocation> {
    const location = await this.em.findOne(SavedLocation, {
      id,
      user: userId,
    });
    if (!location) {
      throw new NotFoundException({
        code: 'SAVED_LOCATION_NOT_FOUND',
        message: 'Saved location not found',
      });
    }
    return location;
  }
}

function toResponseDto(location: SavedLocation): SavedLocationResponseDto {
  return {
    id: location.id,
    name: location.name,
    city: location.city,
    region: location.region,
    countryCode: location.countryCode,
    latitude: location.latitude,
    longitude: location.longitude,
    notificationsEnabled: location.notificationsEnabled,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}
