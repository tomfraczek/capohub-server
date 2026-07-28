import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CreateCohortInput } from './dto/create-cohort.schema';
import { Group } from './entities/group.entity';
import { Cohort } from './entities/cohort.entity';
import { CohortStatus } from './enums/cohort-status.enum';
import { CohortsService } from './cohorts.service';

function buildCreateInput(
  overrides: Partial<CreateCohortInput> = {},
): CreateCohortInput {
  return {
    name: 'Kids',
    description: null,
    ...overrides,
  };
}

function buildCohort(overrides: Partial<Cohort> = {}): Cohort {
  const cohort = new Cohort();
  cohort.id = 'cohort-1';
  cohort.name = 'Kids';
  cohort.status = CohortStatus.ACTIVE;
  const group = new Group();
  group.id = 'group-1';
  cohort.group = group;
  return Object.assign(cohort, overrides);
}

interface MockRouting {
  cohort?: Cohort | null;
  cohorts?: Cohort[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [Cohort]>()
    .mockReturnValue({ flush });
  const findOne = jest
    .fn()
    .mockResolvedValue(routing.cohort === undefined ? null : routing.cohort);
  const find = jest.fn().mockResolvedValue(routing.cohorts ?? []);
  const getReference = jest.fn((_entity: unknown, id: string) => {
    const group = new Group();
    group.id = id;
    return group;
  });

  const raw = { findOne, find, persist, flush, getReference };
  return { em: raw as unknown as EntityManager, persist, flush };
}

describe('CohortsService', () => {
  describe('create', () => {
    it('creates a cohort attached to the given group', async () => {
      const { em, persist } = buildMockEm();
      const service = new CohortsService(em);

      const result = await service.create('group-1', buildCreateInput());

      const persistedCohort = persist.mock.calls[0][0];
      expect(persistedCohort.group.id).toBe('group-1');
      expect(result.groupId).toBe('group-1');
      expect(result.name).toBe('Kids');
      expect(result.status).toBe(CohortStatus.ACTIVE);
    });
  });

  describe('list', () => {
    it('returns every cohort for the group - and an empty array when none exist', async () => {
      const withCohorts = buildMockEm({ cohorts: [buildCohort()] });
      const withoutCohorts = buildMockEm({ cohorts: [] });

      const resultWithCohorts = await new CohortsService(withCohorts.em).list(
        'group-1',
      );
      const resultWithoutCohorts = await new CohortsService(
        withoutCohorts.em,
      ).list('group-1');

      expect(resultWithCohorts).toHaveLength(1);
      expect(resultWithoutCohorts).toEqual([]);
    });
  });

  describe('getById', () => {
    it('throws COHORT_NOT_FOUND when the cohort does not exist', async () => {
      const { em } = buildMockEm({ cohort: null });
      const service = new CohortsService(em);

      const promise = service.getById('group-1', 'missing');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'COHORT_NOT_FOUND' },
      });
    });
  });

  describe('update', () => {
    it('applies every field from the input', async () => {
      const existing = buildCohort({ name: 'Old name' });
      const { em } = buildMockEm({ cohort: existing });
      const service = new CohortsService(em);

      await service.update(
        'group-1',
        'cohort-1',
        buildCreateInput({ name: 'New name' }),
      );

      expect(existing.name).toBe('New name');
    });

    it('rejects updating an archived cohort', async () => {
      const existing = buildCohort({ status: CohortStatus.ARCHIVED });
      const { em } = buildMockEm({ cohort: existing });
      const service = new CohortsService(em);

      const promise = service.update('group-1', 'cohort-1', buildCreateInput());

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'COHORT_ARCHIVED' },
      });
    });
  });

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const existing = buildCohort({ status: CohortStatus.ACTIVE });
      const { em } = buildMockEm({ cohort: existing });
      const service = new CohortsService(em);

      await service.archive('group-1', 'cohort-1');

      expect(existing.status).toBe(CohortStatus.ARCHIVED);
    });

    it('rejects archiving an already-archived cohort', async () => {
      const existing = buildCohort({ status: CohortStatus.ARCHIVED });
      const { em } = buildMockEm({ cohort: existing });
      const service = new CohortsService(em);

      await expect(
        service.archive('group-1', 'cohort-1'),
      ).rejects.toMatchObject({ response: { code: 'COHORT_ARCHIVED' } });
    });
  });
});
