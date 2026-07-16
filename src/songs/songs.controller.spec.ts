import { User } from '../users/entities/user.entity';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import { SongStatus } from './enums/song-status.enum';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';

function buildUser(): User {
  const user = new User();
  user.id = 'user-uuid-1';
  user.email = 'ada@example.com';
  user.displayName = 'Ada Lovelace';
  return user;
}

function buildDetailsResponse(
  overrides: Partial<SongDetailsResponseDto> = {},
): SongDetailsResponseDto {
  return {
    id: 'song-uuid-1',
    title: 'Paranauê',
    slug: 'paranaue',
    authorName: null,
    status: SongStatus.DRAFT,
    category: { id: 'cat-1', code: 'CORRIDO', name: 'Corrido', position: 1 },
    createdBy: null,
    alternativeTitles: [],
    tags: [],
    parts: [],
    media: [],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SongsController', () => {
  describe('create', () => {
    it('passes @CurrentUser() and the validated body to SongsService.create', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse();
      const create = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        create,
      } as unknown as SongsService);

      const body = {
        title: 'Paranauê',
        slug: 'paranaue',
      } as unknown as Parameters<SongsController['create']>[1];

      const response = await controller.create(user, body);

      expect(create).toHaveBeenCalledWith(user, body);
      expect(response).toBe(dto);
    });
  });

  describe('list', () => {
    it('passes @CurrentUser() and the validated query to SongsService.list', async () => {
      const user = buildUser();
      const paginated = { data: [], meta: {} } as never;
      const list = jest.fn().mockResolvedValue(paginated);
      const controller = new SongsController({
        list,
      } as unknown as SongsService);

      const query = { page: 1, limit: 20 } as unknown as Parameters<
        SongsController['list']
      >[1];
      const response = await controller.list(user, query);

      expect(list).toHaveBeenCalledWith(user, query);
      expect(response).toBe(paginated);
    });
  });

  describe('getDetails', () => {
    it('delegates to SongsService.getDetails with the id param', async () => {
      const dto = buildDetailsResponse();
      const getDetails = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        getDetails,
      } as unknown as SongsService);

      const response = await controller.getDetails('song-uuid-1');

      expect(getDetails).toHaveBeenCalledWith('song-uuid-1');
      expect(response).toBe(dto);
    });
  });

  describe('update', () => {
    it('delegates to SongsService.update with id, user and body', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse();
      const update = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        update,
      } as unknown as SongsService);

      const body = { title: 'New title' } as unknown as Parameters<
        SongsController['update']
      >[2];
      const response = await controller.update('song-uuid-1', user, body);

      expect(update).toHaveBeenCalledWith('song-uuid-1', user, body);
      expect(response).toBe(dto);
    });
  });

  describe('delete', () => {
    it('delegates to SongsService.delete and returns void (204)', async () => {
      const del = jest.fn().mockResolvedValue(undefined);
      const controller = new SongsController({
        delete: del,
      } as unknown as SongsService);

      const response = await controller.delete('song-uuid-1');

      expect(del).toHaveBeenCalledWith('song-uuid-1');
      expect(response).toBeUndefined();
    });
  });

  describe.each([
    ['submit', 'submit'] as const,
    ['publish', 'publish'] as const,
    ['reject', 'reject'] as const,
    ['hide', 'hide'] as const,
    ['restore', 'restore'] as const,
  ])('%s', (controllerMethod, serviceMethod) => {
    it(`delegates to SongsService.${serviceMethod} with the id param`, async () => {
      const dto = buildDetailsResponse();
      const serviceFn = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        [serviceMethod]: serviceFn,
      } as unknown as SongsService);

      const response = await (
        controller[controllerMethod as keyof SongsController] as (
          id: string,
        ) => Promise<SongDetailsResponseDto>
      ).call(controller, 'song-uuid-1');

      expect(serviceFn).toHaveBeenCalledWith('song-uuid-1');
      expect(response).toBe(dto);
    });
  });
});
