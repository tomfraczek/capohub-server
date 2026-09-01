import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../auth/permissions/permission.enum';
import { User } from '../users/entities/user.entity';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import { SongStatus } from './enums/song-status.enum';
import { ModerationSongsController } from './moderation-songs.controller';
import { SongsService } from './songs.service';

function buildUser(): User {
  const user = new User();
  user.id = 'moderator-uuid-1';
  user.email = 'mod@example.com';
  user.displayName = 'Mod Erator';
  return user;
}

function buildDetailsResponse(
  overrides: Partial<SongDetailsResponseDto> = {},
): SongDetailsResponseDto {
  return {
    id: 'song-uuid-1',
    title: 'Paranauê',
    authorName: null,
    status: SongStatus.PENDING_REVIEW,
    rejectionReason: null,
    category: { id: 'cat-1', code: 'CORRIDO', name: 'Corrido', position: 1 },
    createdBy: null,
    alternativeTitles: [],
    tags: [],
    parts: [],
    media: [],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
    rhythms: [],
    isFavorite: false,
    learningStatus: null,
    myNote: null,
    playlists: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ModerationSongsController', () => {
  describe('list', () => {
    it('delegates to SongsService.listModerationQueue with the validated query', async () => {
      const paginated = { data: [], meta: {} } as never;
      const listModerationQueue = jest.fn().mockResolvedValue(paginated);
      const controller = new ModerationSongsController({
        listModerationQueue,
      } as unknown as SongsService);

      const query = {
        page: 1,
        limit: 20,
        status: SongStatus.PENDING_REVIEW as const,
      };
      const response = await controller.list(query);

      expect(listModerationQueue).toHaveBeenCalledWith(query);
      expect(response).toBe(paginated);
    });
  });

  describe('getById', () => {
    it('delegates to SongsService.getModerationDetails (PENDING_REVIEW/REJECTED only) with the id param and current user id', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse();
      const getModerationDetails = jest.fn().mockResolvedValue(dto);
      const controller = new ModerationSongsController({
        getModerationDetails,
      } as unknown as SongsService);

      const response = await controller.getById('song-uuid-1', user);

      expect(getModerationDetails).toHaveBeenCalledWith('song-uuid-1', user.id);
      expect(response).toBe(dto);
    });
  });

  describe('guard/permission metadata', () => {
    it('is class-level guarded by PermissionsGuard and requires Permission.CONTENT_APPROVE', () => {
      const reflector = new Reflector();

      expect(
        reflector.get<unknown[]>(GUARDS_METADATA, ModerationSongsController),
      ).toEqual([PermissionsGuard]);
      expect(
        reflector.get<Permission[]>(PERMISSIONS_KEY, ModerationSongsController),
      ).toEqual([Permission.CONTENT_APPROVE]);
    });
  });
});
