import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CreateSectionInput } from './dto/create-section.schema';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionStatus } from './enums/section-status.enum';
import { SectionsService } from './sections.service';

function buildCreateInput(
  overrides: Partial<CreateSectionInput> = {},
): CreateSectionInput {
  return {
    name: 'Kids',
    description: null,
    ...overrides,
  };
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Kids';
  section.status = SectionStatus.ACTIVE;
  const group = new Group();
  group.id = 'group-1';
  section.group = group;
  return Object.assign(section, overrides);
}

interface MockRouting {
  section?: Section | null;
  sections?: Section[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [Section]>()
    .mockReturnValue({ flush });
  const findOne = jest
    .fn()
    .mockResolvedValue(routing.section === undefined ? null : routing.section);
  const find = jest.fn().mockResolvedValue(routing.sections ?? []);
  const getReference = jest.fn((_entity: unknown, id: string) => {
    const group = new Group();
    group.id = id;
    return group;
  });

  const raw = { findOne, find, persist, flush, getReference };
  return { em: raw as unknown as EntityManager, persist, flush };
}

describe('SectionsService', () => {
  describe('create', () => {
    it('creates a section attached to the given group', async () => {
      const { em, persist } = buildMockEm();
      const service = new SectionsService(em);

      const result = await service.create('group-1', buildCreateInput());

      const persistedSection = persist.mock.calls[0][0];
      expect(persistedSection.group.id).toBe('group-1');
      expect(result.groupId).toBe('group-1');
      expect(result.name).toBe('Kids');
      expect(result.status).toBe(SectionStatus.ACTIVE);
    });
  });

  describe('list', () => {
    it('returns every section for the group - and an empty array when none exist', async () => {
      const withSections = buildMockEm({ sections: [buildSection()] });
      const withoutSections = buildMockEm({ sections: [] });

      const resultWithSections = await new SectionsService(
        withSections.em,
      ).list('group-1');
      const resultWithoutSections = await new SectionsService(
        withoutSections.em,
      ).list('group-1');

      expect(resultWithSections).toHaveLength(1);
      expect(resultWithoutSections).toEqual([]);
    });
  });

  describe('getById', () => {
    it('throws SECTION_NOT_FOUND when the section does not exist', async () => {
      const { em } = buildMockEm({ section: null });
      const service = new SectionsService(em);

      const promise = service.getById('group-1', 'missing');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'SECTION_NOT_FOUND' },
      });
    });
  });

  describe('update', () => {
    it('applies every field from the input', async () => {
      const existing = buildSection({ name: 'Old name' });
      const { em } = buildMockEm({ section: existing });
      const service = new SectionsService(em);

      await service.update(
        'group-1',
        'section-1',
        buildCreateInput({ name: 'New name' }),
      );

      expect(existing.name).toBe('New name');
    });

    it('rejects updating an archived section', async () => {
      const existing = buildSection({ status: SectionStatus.ARCHIVED });
      const { em } = buildMockEm({ section: existing });
      const service = new SectionsService(em);

      const promise = service.update(
        'group-1',
        'section-1',
        buildCreateInput(),
      );

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'SECTION_ARCHIVED' },
      });
    });
  });

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const existing = buildSection({ status: SectionStatus.ACTIVE });
      const { em } = buildMockEm({ section: existing });
      const service = new SectionsService(em);

      await service.archive('group-1', 'section-1');

      expect(existing.status).toBe(SectionStatus.ARCHIVED);
    });

    it('rejects archiving an already-archived section', async () => {
      const existing = buildSection({ status: SectionStatus.ARCHIVED });
      const { em } = buildMockEm({ section: existing });
      const service = new SectionsService(em);

      await expect(
        service.archive('group-1', 'section-1'),
      ).rejects.toMatchObject({ response: { code: 'SECTION_ARCHIVED' } });
    });
  });
});
