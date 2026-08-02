import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AcademiesService } from './academies.service';
import { CreateAcademyInput } from './dto/create-academy.schema';
import { Academy } from './entities/academy.entity';
import { Group } from './entities/group.entity';
import { AcademyStatus } from './enums/academy-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';

function buildCreateInput(
  overrides: Partial<CreateAcademyInput> = {},
): CreateAcademyInput {
  return {
    name: 'Academy Center',
    address: null,
    latitude: null,
    longitude: null,
    contactEmail: null,
    contactPhone: null,
    openingHours: null,
    photoUrls: null,
    description: null,
    ...overrides,
  };
}

function buildAcademy(overrides: Partial<Academy> = {}): Academy {
  const academy = new Academy();
  academy.id = 'academy-1';
  academy.name = 'Academy Center';
  academy.status = AcademyStatus.ACTIVE;
  const group = new Group();
  group.id = 'group-1';
  academy.group = group;
  return Object.assign(academy, overrides);
}

interface MockRouting {
  academy?: Academy | null;
  academies?: Academy[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [Academy]>()
    .mockReturnValue({ flush });
  const findOne = jest
    .fn()
    .mockResolvedValue(routing.academy === undefined ? null : routing.academy);
  const find = jest.fn().mockResolvedValue(routing.academies ?? []);

  const raw = { findOne, find, persist, flush };
  return { em: raw as unknown as EntityManager, persist, flush };
}

function buildGroupHierarchyService(): GroupHierarchyService {
  return {
    findCommunityById: jest.fn((id: string) => {
      const group = new Group();
      group.id = id;
      return Promise.resolve(group);
    }),
  } as unknown as GroupHierarchyService;
}

describe('AcademiesService', () => {
  describe('create', () => {
    it('creates an academy attached to the given group', async () => {
      const { em, persist } = buildMockEm();
      const service = new AcademiesService(em, buildGroupHierarchyService());

      const result = await service.create('group-1', buildCreateInput());

      const persistedAcademy = persist.mock.calls[0][0];
      expect(persistedAcademy.group?.id).toBe('group-1');
      expect(result.groupId).toBe('group-1');
      expect(result.name).toBe('Academy Center');
      expect(result.status).toBe(AcademyStatus.ACTIVE);
    });
  });

  describe('list', () => {
    it('returns every academy for the group', async () => {
      const { em } = buildMockEm({ academies: [buildAcademy()] });
      const service = new AcademiesService(em, buildGroupHierarchyService());

      const result = await service.list('group-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('academy-1');
    });
  });

  describe('getById', () => {
    it('throws ACADEMY_NOT_FOUND when the academy does not exist', async () => {
      const { em } = buildMockEm({ academy: null });
      const service = new AcademiesService(em, buildGroupHierarchyService());

      const promise = service.getById('group-1', 'missing');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'ACADEMY_NOT_FOUND' },
      });
    });
  });

  describe('update', () => {
    it('applies every field from the input', async () => {
      const existing = buildAcademy({ name: 'Old name' });
      const { em } = buildMockEm({ academy: existing });
      const service = new AcademiesService(em, buildGroupHierarchyService());

      await service.update(
        'group-1',
        'academy-1',
        buildCreateInput({ name: 'New name' }),
      );

      expect(existing.name).toBe('New name');
    });

    it('rejects updating an archived academy', async () => {
      const existing = buildAcademy({ status: AcademyStatus.ARCHIVED });
      const { em } = buildMockEm({ academy: existing });
      const service = new AcademiesService(em, buildGroupHierarchyService());

      const promise = service.update(
        'group-1',
        'academy-1',
        buildCreateInput(),
      );

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'ACADEMY_ARCHIVED' },
      });
    });
  });

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const existing = buildAcademy({ status: AcademyStatus.ACTIVE });
      const { em } = buildMockEm({ academy: existing });
      const service = new AcademiesService(em, buildGroupHierarchyService());

      await service.archive('group-1', 'academy-1');

      expect(existing.status).toBe(AcademyStatus.ARCHIVED);
    });

    it('rejects archiving an already-archived academy', async () => {
      const existing = buildAcademy({ status: AcademyStatus.ARCHIVED });
      const { em } = buildMockEm({ academy: existing });
      const service = new AcademiesService(em, buildGroupHierarchyService());

      await expect(
        service.archive('group-1', 'academy-1'),
      ).rejects.toMatchObject({ response: { code: 'ACADEMY_ARCHIVED' } });
    });
  });
});
