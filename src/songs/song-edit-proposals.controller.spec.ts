import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../auth/permissions/permission.enum';
import { User } from '../users/entities/user.entity';
import { SongEditProposalResponseDto } from './dto/song-edit-proposal-response.dto';
import { SongEditProposalStatus } from './enums/song-edit-proposal-status.enum';
import { SongEditProposalsController } from './song-edit-proposals.controller';
import { SongEditProposalsService } from './song-edit-proposals.service';

function buildUser(): User {
  const user = new User();
  user.id = 'user-uuid-1';
  user.email = 'ada@example.com';
  user.displayName = 'Ada Lovelace';
  return user;
}

function buildProposalResponse(
  overrides: Partial<SongEditProposalResponseDto> = {},
): SongEditProposalResponseDto {
  return {
    id: 'proposal-uuid-1',
    songId: 'song-uuid-1',
    proposedBy: {
      id: 'user-uuid-1',
      displayName: 'Ada Lovelace',
      gender: null,
    },
    status: SongEditProposalStatus.PENDING,
    payload: {
      title: 'Paranauê',
      authorName: null,
      categoryId: 'category-id',
      alternativeTitles: [],
      tagIds: [],
      parts: [],
      media: [],
      meaningHistory: null,
      meaningContext: null,
      meaningTrivia: null,
    },
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SongEditProposalsController', () => {
  describe('create', () => {
    it('delegates to SongEditProposalsService.create with songId, user and body', async () => {
      const user = buildUser();
      const dto = buildProposalResponse();
      const create = jest.fn().mockResolvedValue(dto);
      const controller = new SongEditProposalsController({
        create,
      } as unknown as SongEditProposalsService);

      const body = { title: 'New title' } as unknown as Parameters<
        SongEditProposalsController['create']
      >[2];
      const response = await controller.create('song-uuid-1', user, body);

      expect(create).toHaveBeenCalledWith('song-uuid-1', user, body);
      expect(response).toBe(dto);
    });

    // Any authenticated user may propose a change to a published/hidden
    // song - no permission or ownership check, only the global
    // ClerkAuthGuard applies (see the controller's own comment).
    it('carries no declarative @Permissions() metadata', () => {
      const reflector = new Reflector();
      const method: keyof SongEditProposalsController = 'create';
      const handlerRef = SongEditProposalsController.prototype[method];

      expect(
        reflector.get<Permission[] | undefined>(PERMISSIONS_KEY, handlerRef),
      ).toBeUndefined();
    });
  });

  describe('list', () => {
    it('delegates to SongEditProposalsService.list with songId', async () => {
      const dtos = [buildProposalResponse()];
      const list = jest.fn().mockResolvedValue(dtos);
      const controller = new SongEditProposalsController({
        list,
      } as unknown as SongEditProposalsService);

      const response = await controller.list('song-uuid-1');

      expect(list).toHaveBeenCalledWith('song-uuid-1');
      expect(response).toBe(dtos);
    });

    it('is guarded by PermissionsGuard and requires Permission.CONTENT_APPROVE', () => {
      const reflector = new Reflector();
      const method: keyof SongEditProposalsController = 'list';
      const handlerRef = SongEditProposalsController.prototype[method];

      expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
        PermissionsGuard,
      ]);
      expect(reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef)).toEqual([
        Permission.CONTENT_APPROVE,
      ]);
    });
  });

  describe('getById', () => {
    it('delegates to SongEditProposalsService.getById with songId and proposalId', async () => {
      const dto = buildProposalResponse();
      const getById = jest.fn().mockResolvedValue(dto);
      const controller = new SongEditProposalsController({
        getById,
      } as unknown as SongEditProposalsService);

      const response = await controller.getById(
        'song-uuid-1',
        'proposal-uuid-1',
      );

      expect(getById).toHaveBeenCalledWith('song-uuid-1', 'proposal-uuid-1');
      expect(response).toBe(dto);
    });

    it('is guarded by PermissionsGuard and requires Permission.CONTENT_APPROVE', () => {
      const reflector = new Reflector();
      const method: keyof SongEditProposalsController = 'getById';
      const handlerRef = SongEditProposalsController.prototype[method];

      expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
        PermissionsGuard,
      ]);
      expect(reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef)).toEqual([
        Permission.CONTENT_APPROVE,
      ]);
    });
  });

  describe('approve', () => {
    it('delegates to SongEditProposalsService.approve with songId, proposalId and user', async () => {
      const user = buildUser();
      const dto = buildProposalResponse({
        status: SongEditProposalStatus.APPROVED,
      });
      const approve = jest.fn().mockResolvedValue(dto);
      const controller = new SongEditProposalsController({
        approve,
      } as unknown as SongEditProposalsService);

      const response = await controller.approve(
        'song-uuid-1',
        'proposal-uuid-1',
        user,
      );

      expect(approve).toHaveBeenCalledWith(
        'song-uuid-1',
        'proposal-uuid-1',
        user,
      );
      expect(response).toBe(dto);
    });

    it('is guarded by PermissionsGuard and requires Permission.CONTENT_APPROVE', () => {
      const reflector = new Reflector();
      const method: keyof SongEditProposalsController = 'approve';
      const handlerRef = SongEditProposalsController.prototype[method];

      expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
        PermissionsGuard,
      ]);
      expect(reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef)).toEqual([
        Permission.CONTENT_APPROVE,
      ]);
    });
  });

  describe('reject', () => {
    it('delegates to SongEditProposalsService.reject with songId, proposalId, user and body', async () => {
      const user = buildUser();
      const dto = buildProposalResponse({
        status: SongEditProposalStatus.REJECTED,
      });
      const reject = jest.fn().mockResolvedValue(dto);
      const controller = new SongEditProposalsController({
        reject,
      } as unknown as SongEditProposalsService);

      const response = await controller.reject(
        'song-uuid-1',
        'proposal-uuid-1',
        user,
        { reason: 'Needs another source' },
      );

      expect(reject).toHaveBeenCalledWith(
        'song-uuid-1',
        'proposal-uuid-1',
        user,
        { reason: 'Needs another source' },
      );
      expect(response).toBe(dto);
    });

    it('is guarded by PermissionsGuard and requires Permission.CONTENT_APPROVE', () => {
      const reflector = new Reflector();
      const method: keyof SongEditProposalsController = 'reject';
      const handlerRef = SongEditProposalsController.prototype[method];

      expect(reflector.get<unknown[]>(GUARDS_METADATA, handlerRef)).toEqual([
        PermissionsGuard,
      ]);
      expect(reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef)).toEqual([
        Permission.CONTENT_APPROVE,
      ]);
    });
  });
});
