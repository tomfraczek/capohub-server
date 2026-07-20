import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Group } from './entities/group.entity';
import { GroupStatus } from './enums/group-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';

function buildGroup(
  id: string,
  parent: Group | null = null,
  status: GroupStatus = GroupStatus.ACTIVE,
): Group {
  const group = new Group();
  group.id = id;
  group.name = id;
  group.parentGroup = parent;
  group.status = status;
  return group;
}

interface FindWhere {
  id?: string;
  parentGroup?: { $in: string[] };
}

function buildMockEm(groups: Group[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));

  const findOne = jest.fn(
    (_entity: unknown, where: FindWhere): Group | null =>
      byId.get(where.id as string) ?? null,
  );

  const find = jest.fn((_entity: unknown, where: FindWhere): Group[] => {
    const parentIds = where.parentGroup?.$in ?? [];
    return groups.filter(
      (group) => group.parentGroup && parentIds.includes(group.parentGroup.id),
    );
  });

  const raw = { findOne, find };

  return raw as unknown as EntityManager;
}

describe('GroupHierarchyService', () => {
  // Capoeira Brasil (root) -> Poland -> Poznan -> Steszew
  //                        -> Konin
  let brasil: Group;
  let poland: Group;
  let poznan: Group;
  let steszew: Group;
  let konin: Group;

  function buildTree(): Group[] {
    brasil = buildGroup('brasil');
    poland = buildGroup('poland', brasil);
    poznan = buildGroup('poznan', poland);
    steszew = buildGroup('steszew', poznan);
    konin = buildGroup('konin', poland);
    return [brasil, poland, poznan, steszew, konin];
  }

  describe('getRootGroup', () => {
    it('returns the group itself when it is already a Root Group', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      const root = await service.getRootGroup('brasil');

      expect(root.id).toBe('brasil');
    });

    it('walks up multiple levels to find the Root Group', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      const root = await service.getRootGroup('steszew');

      expect(root.id).toBe('brasil');
    });
  });

  describe('getAncestors', () => {
    it('returns an empty array for a Root Group', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      expect(await service.getAncestors('brasil')).toEqual([]);
    });

    it('returns ancestors ordered from the Root Group down', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      const ancestors = await service.getAncestors('steszew');

      expect(ancestors.map((group) => group.id)).toEqual([
        'brasil',
        'poland',
        'poznan',
      ]);
    });
  });

  describe('getDescendants', () => {
    it('returns every descendant at every depth', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      const descendants = await service.getDescendants('brasil');

      expect(new Set(descendants.map((group) => group.id))).toEqual(
        new Set(['poland', 'poznan', 'steszew', 'konin']),
      );
    });

    it('returns an empty array for a leaf group', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      expect(await service.getDescendants('steszew')).toEqual([]);
    });
  });

  describe('assertParentIsUsable', () => {
    it('throws GROUP_PARENT_NOT_FOUND when the parent does not exist', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      await expect(
        service.assertParentIsUsable('missing'),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_PARENT_NOT_FOUND' },
      });
      await expect(
        service.assertParentIsUsable('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws GROUP_ARCHIVED when the parent is archived', async () => {
      const archived = buildGroup(
        'archived-parent',
        null,
        GroupStatus.ARCHIVED,
      );
      const em = buildMockEm([...buildTree(), archived]);
      const service = new GroupHierarchyService(em);

      await expect(
        service.assertParentIsUsable('archived-parent'),
      ).rejects.toMatchObject({ response: { code: 'GROUP_ARCHIVED' } });
    });

    it('returns the parent when it exists and is not archived', async () => {
      const em = buildMockEm(buildTree());
      const service = new GroupHierarchyService(em);

      const parent = await service.assertParentIsUsable('poland');

      expect(parent.id).toBe('poland');
    });
  });
});
