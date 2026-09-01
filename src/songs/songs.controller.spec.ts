import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { User } from '../users/entities/user.entity';
import { DuplicateSuggestionsResponseDto } from './dto/duplicate-suggestion-response.dto';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import { SongMediaDetailsResponseDto } from './dto/song-media-details-response.dto';
import { SongMediaVoteResponseDto } from './dto/song-media-vote-response.dto';
import { SongMediaProvider } from './enums/song-media-provider.enum';
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
    authorName: null,
    status: SongStatus.DRAFT,
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

function buildMediaResponse(
  overrides: Partial<SongMediaDetailsResponseDto> = {},
): SongMediaDetailsResponseDto {
  return {
    id: 'media-uuid-1',
    songId: 'song-uuid-1',
    provider: SongMediaProvider.YOUTUBE,
    url: 'https://www.youtube.com/watch?v=abc',
    title: null,
    position: 1,
    isVerified: true,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildVoteResponse(
  overrides: Partial<SongMediaVoteResponseDto> = {},
): SongMediaVoteResponseDto {
  return {
    songId: 'song-uuid-1',
    mediaId: 'media-uuid-1',
    voteCount: 1,
    isVotedByCurrentUser: true,
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

  describe('getDuplicateSuggestions', () => {
    it('delegates to SongsService.getDuplicateSuggestions with user, title and limit', async () => {
      const user = buildUser();
      const dto: DuplicateSuggestionsResponseDto = { items: [] };
      const getDuplicateSuggestions = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        getDuplicateSuggestions,
      } as unknown as SongsService);

      const query = { title: 'Paranauê', limit: 5 };
      const response = await controller.getDuplicateSuggestions(user, query);

      expect(getDuplicateSuggestions).toHaveBeenCalledWith(user, 'Paranauê', 5);
      expect(response).toBe(dto);
    });
  });

  describe('getDetails', () => {
    it('delegates to SongsService.getPublicDetails (PUBLISHED-only) with the id param and current user id', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse();
      const getPublicDetails = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        getPublicDetails,
      } as unknown as SongsService);

      const response = await controller.getDetails('song-uuid-1', user);

      expect(getPublicDetails).toHaveBeenCalledWith('song-uuid-1', user.id);
      expect(response).toBe(dto);
    });
  });

  describe('listMySubmissions', () => {
    it('delegates to SongsService.listMySubmissions with @CurrentUser() and the validated query', async () => {
      const user = buildUser();
      const paginated = { data: [], meta: {} } as never;
      const listMySubmissions = jest.fn().mockResolvedValue(paginated);
      const controller = new SongsController({
        listMySubmissions,
      } as unknown as SongsService);

      const query = { page: 1, limit: 20 } as unknown as Parameters<
        SongsController['listMySubmissions']
      >[1];
      const response = await controller.listMySubmissions(user, query);

      expect(listMySubmissions).toHaveBeenCalledWith(user, query);
      expect(response).toBe(paginated);
    });
  });

  describe('getMySubmission', () => {
    it('delegates to SongsService.getMySubmission with the id param and current user id', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse({ status: SongStatus.PENDING_REVIEW });
      const getMySubmission = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        getMySubmission,
      } as unknown as SongsService);

      const response = await controller.getMySubmission('song-uuid-1', user);

      expect(getMySubmission).toHaveBeenCalledWith('song-uuid-1', user.id);
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
    it('delegates to SongsService.delete with the id param and current user, returning void (204)', async () => {
      const user = buildUser();
      const del = jest.fn().mockResolvedValue(undefined);
      const controller = new SongsController({
        delete: del,
      } as unknown as SongsService);

      const response = await controller.delete('song-uuid-1', user);

      expect(del).toHaveBeenCalledWith('song-uuid-1', user);
      expect(response).toBeUndefined();
    });
  });

  describe('submit', () => {
    it('delegates to SongsService.submit with the id param and current user', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse();
      const submit = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        submit,
      } as unknown as SongsService);

      const response = await controller.submit('song-uuid-1', user);

      expect(submit).toHaveBeenCalledWith('song-uuid-1', user);
      expect(response).toBe(dto);
    });
  });

  describe('publish', () => {
    it('delegates to SongsService.publish with the id param and current user', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse();
      const publish = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        publish,
      } as unknown as SongsService);

      const response = await controller.publish('song-uuid-1', user);

      expect(publish).toHaveBeenCalledWith('song-uuid-1', user);
      expect(response).toBe(dto);
    });

    it('is guarded by PermissionsGuard and requires Permission.CONTENT_APPROVE', () => {
      const reflector = new Reflector();
      const method: keyof SongsController = 'publish';
      const handlerRef = SongsController.prototype[method];

      expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
        PermissionsGuard,
      ]);
      expect(reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef)).toEqual([
        Permission.CONTENT_APPROVE,
      ]);
    });
  });

  describe('reject', () => {
    it('delegates to SongsService.reject with the id param, current user and body', async () => {
      const user = buildUser();
      const dto = buildDetailsResponse();
      const reject = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        reject,
      } as unknown as SongsService);

      const response = await controller.reject('song-uuid-1', user, {
        reason: 'Missing translation',
      });

      expect(reject).toHaveBeenCalledWith('song-uuid-1', user, {
        reason: 'Missing translation',
      });
      expect(response).toBe(dto);
    });

    it('is guarded by PermissionsGuard and requires Permission.CONTENT_APPROVE', () => {
      const reflector = new Reflector();
      const method: keyof SongsController = 'reject';
      const handlerRef = SongsController.prototype[method];

      expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
        PermissionsGuard,
      ]);
      expect(reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef)).toEqual([
        Permission.CONTENT_APPROVE,
      ]);
    });
  });

  describe.each([['hide', 'hide'] as const, ['restore', 'restore'] as const])(
    '%s',
    (controllerMethod, serviceMethod) => {
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

      it('is guarded by PermissionsGuard and requires Permission.CONTENT_HIDE', () => {
        const reflector = new Reflector();
        const handlerRef = SongsController.prototype[controllerMethod];

        expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
          PermissionsGuard,
        ]);
        expect(
          reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef),
        ).toEqual([Permission.CONTENT_HIDE]);
      });
    },
  );

  describe('create guard/permission metadata', () => {
    it('is guarded by PermissionsGuard and requires Permission.SONG_CREATE', () => {
      const reflector = new Reflector();
      const method: keyof SongsController = 'create';
      const handlerRef = SongsController.prototype[method];

      expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
        PermissionsGuard,
      ]);
      expect(reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef)).toEqual([
        Permission.SONG_CREATE,
      ]);
    });
  });

  describe('update/submit/delete carry no declarative @Permissions()', () => {
    // Unlike create/publish/reject/hide/restore, these three resolve
    // "own vs. any" only after loading the Song, which a declarative
    // controller-level permission cannot express - see
    // SongsService.assertCanEditDirectly/delete's own comments.
    it.each([['update'], ['submit'], ['delete']] as const)(
      '%s has no PERMISSIONS_KEY metadata',
      (methodName) => {
        const reflector = new Reflector();
        const handlerRef = SongsController.prototype[methodName];

        expect(
          reflector.get<Permission[] | undefined>(PERMISSIONS_KEY, handlerRef),
        ).toBeUndefined();
      },
    );
  });

  describe('media verification', () => {
    it('verifyMedia delegates to SongsService.verifyMedia with songId and mediaId, returning its DTO', async () => {
      const dto = buildMediaResponse({ isVerified: true });
      const verifyMedia = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        verifyMedia,
      } as unknown as SongsService);

      const response = await controller.verifyMedia(
        'song-uuid-1',
        'media-uuid-1',
      );

      expect(verifyMedia).toHaveBeenCalledWith('song-uuid-1', 'media-uuid-1');
      expect(response).toBe(dto);
    });

    it('unverifyMedia delegates to SongsService.unverifyMedia with songId and mediaId, returning its DTO', async () => {
      const dto = buildMediaResponse({ isVerified: false });
      const unverifyMedia = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        unverifyMedia,
      } as unknown as SongsService);

      const response = await controller.unverifyMedia(
        'song-uuid-1',
        'media-uuid-1',
      );

      expect(unverifyMedia).toHaveBeenCalledWith('song-uuid-1', 'media-uuid-1');
      expect(response).toBe(dto);
    });

    describe.each([['verifyMedia'] as const, ['unverifyMedia'] as const])(
      '%s guard/permission metadata',
      (methodName) => {
        it('is guarded by PermissionsGuard', () => {
          const reflector = new Reflector();

          const handlerRef = SongsController.prototype[methodName];
          const guards = reflector.get<unknown[]>(GUARDS_METADATA, handlerRef);

          expect(guards).toEqual([PermissionsGuard]);
        });

        it('requires Permission.CONTENT_APPROVE', () => {
          const reflector = new Reflector();

          const handlerRef = SongsController.prototype[methodName];
          const permissions = reflector.get<Permission[]>(
            PERMISSIONS_KEY,
            handlerRef,
          );

          expect(permissions).toEqual([Permission.CONTENT_APPROVE]);
        });
      },
    );
  });

  describe('media voting', () => {
    it('setMediaVote delegates songId, mediaId and @CurrentUser() to SongsService.setMediaVote', async () => {
      const user = buildUser();
      const dto = buildVoteResponse();
      const setMediaVote = jest.fn().mockResolvedValue(dto);
      const controller = new SongsController({
        setMediaVote,
      } as unknown as SongsService);

      const response = await controller.setMediaVote(
        'song-uuid-1',
        'media-uuid-1',
        user,
      );

      expect(setMediaVote).toHaveBeenCalledWith(
        'song-uuid-1',
        'media-uuid-1',
        user,
      );
      expect(response).toBe(dto);
    });

    it('removeMediaVote delegates songId and @CurrentUser() to SongsService.removeMediaVote', async () => {
      const user = buildUser();
      const removeMediaVote = jest.fn().mockResolvedValue(undefined);
      const controller = new SongsController({
        removeMediaVote,
      } as unknown as SongsService);

      const response = await controller.removeMediaVote('song-uuid-1', user);

      expect(removeMediaVote).toHaveBeenCalledWith('song-uuid-1', user);
      expect(response).toBeUndefined();
    });

    it('setMediaVote and removeMediaVote have no PermissionsGuard - only the global ClerkAuthGuard applies', () => {
      const reflector = new Reflector();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
      const setMediaVoteRef = SongsController.prototype.setMediaVote;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
      const removeMediaVoteRef = SongsController.prototype.removeMediaVote;

      const setGuards = reflector.get<unknown[]>(
        GUARDS_METADATA,
        setMediaVoteRef,
      );
      const removeGuards = reflector.get<unknown[]>(
        GUARDS_METADATA,
        removeMediaVoteRef,
      );

      expect(setGuards).toBeUndefined();
      expect(removeGuards).toBeUndefined();
    });
  });
});
