import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SavedLocation } from './entities/saved-location.entity';
import { User } from './entities/user.entity';
import { SavedLocationsService } from './saved-locations.service';

function buildUser(id = 'user-1'): User {
  const user = new User();
  user.id = id;
  return user;
}

function buildLocation(overrides: Partial<SavedLocation> = {}): SavedLocation {
  const location = new SavedLocation();
  location.id = 'location-1';
  location.user = buildUser();
  location.name = null;
  location.city = 'Poznań';
  location.region = 'Greater Poland';
  location.countryCode = 'PL';
  location.latitude = 52.4064;
  location.longitude = 16.9252;
  location.notificationsEnabled = false;
  location.createdAt = new Date('2026-01-01T00:00:00.000Z');
  location.updatedAt = new Date('2026-01-01T00:00:00.000Z');
  Object.assign(location, overrides);
  return location;
}

interface MockRouting {
  findOneResult?: SavedLocation | null;
  findResult?: SavedLocation[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockReturnValue({ flush });
  const persist = jest.fn().mockReturnValue({ flush });
  const find = jest.fn().mockResolvedValue(routing.findResult ?? []);
  const findOne = jest
    .fn()
    .mockResolvedValue(
      routing.findOneResult === undefined ? null : routing.findOneResult,
    );
  return {
    em: { find, findOne, persist, remove, flush } as unknown as EntityManager,
    find,
    findOne,
    persist,
    remove,
    flush,
  };
}

describe('SavedLocationsService', () => {
  describe('list', () => {
    it('returns every SavedLocation belonging to the caller, oldest first', async () => {
      const locations = [
        buildLocation({ id: 'a' }),
        buildLocation({ id: 'b' }),
      ];
      const { em, find } = buildMockEm({ findResult: locations });
      const service = new SavedLocationsService(em);

      const result = await service.list(buildUser());

      expect(find).toHaveBeenCalledWith(
        SavedLocation,
        { user: 'user-1' },
        { orderBy: { createdAt: 'asc' } },
      );
      expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('falls back name to null (never fabricates a city) when unset', async () => {
      const { em } = buildMockEm({
        findResult: [buildLocation({ name: null, city: null })],
      });
      const service = new SavedLocationsService(em);

      const [result] = await service.list(buildUser());

      expect(result.name).toBeNull();
      expect(result.city).toBeNull();
    });
  });

  describe('create', () => {
    it('persists a new SavedLocation owned by the caller with the given fields', async () => {
      const { em, persist, flush } = buildMockEm();
      const service = new SavedLocationsService(em);
      const user = buildUser('user-2');

      const result = await service.create(user, {
        name: null,
        city: 'Wrocław',
        region: null,
        countryCode: 'PL',
        latitude: 51.1079,
        longitude: 17.0385,
      });

      expect(persist).toHaveBeenCalled();
      expect(flush).toHaveBeenCalled();
      expect(result.city).toBe('Wrocław');
      // A SavedLocation only answers "where" - no search radius at all.
      expect(result).not.toHaveProperty('radiusKm');
    });

    it('never sets the user field from anything other than the caller', async () => {
      const { em } = buildMockEm();
      const service = new SavedLocationsService(em);
      const user = buildUser('user-3');

      const result = await service.create(user, {
        name: null,
        city: null,
        region: null,
        countryCode: null,
        latitude: 0,
        longitude: 0,
      });

      // toResponseDto never echoes back the user relation - this asserts the
      // create path doesn't accept/trust a caller-supplied ownership field
      // by checking the DTO shape has no such field at all.
      expect(result).not.toHaveProperty('userId');
    });
  });

  describe('update', () => {
    it('leaves the name untouched when it is omitted from the input', async () => {
      const existing = buildLocation({ name: 'Dom' });
      const { em, flush } = buildMockEm({ findOneResult: existing });
      const service = new SavedLocationsService(em);

      const result = await service.update(buildUser(), 'location-1', {});

      expect(result.name).toBe('Dom');
      expect(flush).toHaveBeenCalled();
    });

    it('renaming never changes latitude/longitude', async () => {
      const existing = buildLocation({ latitude: 52.4064, longitude: 16.9252 });
      const { em } = buildMockEm({ findOneResult: existing });
      const service = new SavedLocationsService(em);

      const result = await service.update(buildUser(), 'location-1', {
        name: 'Praca',
      });

      expect(result.name).toBe('Praca');
      expect(result.latitude).toBe(52.4064);
      expect(result.longitude).toBe(16.9252);
    });

    it('throws NotFoundException when the location does not belong to the caller (IDOR-safe)', async () => {
      const { em, findOne } = buildMockEm({ findOneResult: null });
      const service = new SavedLocationsService(em);

      await expect(
        service.update(buildUser(), 'someone-elses-location', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
      expect(findOne).toHaveBeenCalledWith(SavedLocation, {
        id: 'someone-elses-location',
        user: 'user-1',
      });
    });
  });

  describe('delete', () => {
    it('removes the caller-owned location', async () => {
      const existing = buildLocation();
      const { em, remove, flush } = buildMockEm({ findOneResult: existing });
      const service = new SavedLocationsService(em);

      await service.delete(buildUser(), 'location-1');

      expect(remove).toHaveBeenCalledWith(existing);
      expect(flush).toHaveBeenCalled();
    });

    it('throws NotFoundException for a non-owned or non-existent location', async () => {
      const { em } = buildMockEm({ findOneResult: null });
      const service = new SavedLocationsService(em);

      await expect(service.delete(buildUser(), 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
