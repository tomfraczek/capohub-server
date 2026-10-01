import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogService } from '../groups/audit-log.service';
import { Group } from '../groups/entities/group.entity';
import { User } from '../users/entities/user.entity';
import { GraduationSystemService } from './graduation-system.service';
import { GraduationSystem } from './entities/graduation-system.entity';

function buildActor(): User {
  const user = new User();
  user.id = 'user-1';
  return user;
}

interface MockRouting {
  existingSystem?: GraduationSystem | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });
  const findOne = jest
    .fn()
    .mockResolvedValue(
      routing.existingSystem === undefined ? null : routing.existingSystem,
    );
  const group = new Group();
  group.id = 'group-1';
  const getReference = jest.fn().mockReturnValue(group);

  const raw = { findOne, persist, flush, getReference };
  return { em: raw as unknown as EntityManager, persist, flush, getReference };
}

function buildAuditLogService(): AuditLogService {
  return { record: jest.fn() } as unknown as AuditLogService;
}

describe('GraduationSystemService', () => {
  describe('getByGroup', () => {
    it('throws GRADUATION_SYSTEM_NOT_FOUND when the group has no active system', async () => {
      const { em } = buildMockEm({ existingSystem: null });
      const service = new GraduationSystemService(em, buildAuditLogService());

      const promise = service.getByGroup('group-1');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'GRADUATION_SYSTEM_NOT_FOUND' },
      });
    });
  });

  describe('create', () => {
    it('creates a system when the group has none yet', async () => {
      const { em, persist } = buildMockEm({ existingSystem: null });
      const service = new GraduationSystemService(em, buildAuditLogService());

      const result = await service.create('group-1', buildActor());

      expect(persist).toHaveBeenCalled();
      expect(result.groupId).toBe('group-1');
      expect(result.isActive).toBe(true);
    });

    it('rejects creating a second active system for the same group', async () => {
      const existing = new GraduationSystem();
      existing.id = 'system-1';
      const group = new Group();
      group.id = 'group-1';
      existing.group = group;

      const { em } = buildMockEm({ existingSystem: existing });
      const service = new GraduationSystemService(em, buildAuditLogService());

      const promise = service.create('group-1', buildActor());

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'GRADUATION_SYSTEM_ALREADY_EXISTS' },
      });
    });
  });
});
