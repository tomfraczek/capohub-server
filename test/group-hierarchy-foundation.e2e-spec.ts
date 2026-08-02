/**
 * Foundation tests for the organizational-domain rebuild, stage 1: Group
 * and Section as two independent, physically-stored entity types, and the
 * centralized hierarchy rules in GroupHierarchyService.
 *
 * Exercises GroupHierarchyService and the Group/Section entities directly
 * against a real database (no HTTP layer - attach/detach are not public
 * endpoints at this stage, see group-hierarchy.service.ts), covering:
 *  - creating a standalone Section (no parent)
 *  - creating a Group (no parent)
 *  - attach/detach Section <-> Group
 *  - attach/detach Group <-> Group
 *  - a Group containing both child Groups and Sections at once
 *  - rejecting a second parent (attach always replaces, never adds)
 *  - rejecting self-parent
 *  - rejecting a direct cycle
 *  - rejecting a multi-level cycle
 *  - type immutability across attach/detach (a Group never becomes a
 *    Section and vice versa)
 */

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { GroupStatus } from '../src/groups/enums/group-status.enum';
import { GroupHierarchyService } from '../src/groups/group-hierarchy.service';

function communityDefaults() {
  return {
    isPublic: true,
    isHidden: false,
    memberInvitesAllowed: false,
    status: GroupStatus.ACTIVE,
    timezone: 'Europe/Warsaw',
    currencyCode: 'PLN',
  };
}

describe('Group/Section foundation (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let hierarchy: GroupHierarchyService;
  const createdGroupIds: string[] = [];
  const createdSectionIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    em = app.get(EntityManager).fork();
    hierarchy = app.get(GroupHierarchyService);
  });

  afterAll(async () => {
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(Section, { id: { $in: createdSectionIds } });
    await cleanup.nativeUpdate(
      Group,
      { id: { $in: createdGroupIds } },
      { parentGroup: null },
    );
    await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
    await app.close();
  });

  async function makeGroup(
    name: string,
    parent: Group | null = null,
  ): Promise<Group> {
    const group = new Group();
    group.name = name;
    group.publicCode = `TST-${randomUUID().slice(0, 8).toUpperCase()}`;
    group.parentGroup = parent;
    Object.assign(group, communityDefaults());
    await em.persist(group).flush();
    createdGroupIds.push(group.id);
    return group;
  }

  async function makeSection(
    name: string,
    parent: Group | null = null,
  ): Promise<Section> {
    const section = new Section();
    section.name = name;
    section.publicCode = `TST-${randomUUID().slice(0, 8).toUpperCase()}`;
    section.parentGroup = parent;
    Object.assign(section, communityDefaults());
    await em.persist(section).flush();
    createdSectionIds.push(section.id);
    return section;
  }

  describe('creation', () => {
    it('creates a standalone Section with no parent', async () => {
      const section = await makeSection('Standalone Section');
      expect(section.parentGroup).toBeNull();
      expect(section.id).toBeDefined();
    });

    it('creates a Group with no parent', async () => {
      const group = await makeGroup('Root Group');
      expect(group.parentGroup).toBeNull();
    });

    it('creates a Section attached to a Group at creation time', async () => {
      const group = await makeGroup('Parent At Creation');
      const section = await makeSection('Child At Creation', group);
      expect(section.parentGroup?.id).toBe(group.id);
    });

    it('creates a Group attached to another Group at creation time', async () => {
      const parent = await makeGroup('Parent Group At Creation');
      const child = await makeGroup('Child Group At Creation', parent);
      expect(child.parentGroup?.id).toBe(parent.id);
    });
  });

  describe('attach / detach Section <-> Group', () => {
    it('attaches a standalone Section to a Group', async () => {
      const group = await makeGroup('Attach Target Group');
      const section = await makeSection('Attach Source Section');

      const attached = await hierarchy.attachSection(section.id, group.id, em);

      expect(attached.parentGroup?.id).toBe(group.id);
      const directSections = await hierarchy.listDirectSections(group.id, em);
      expect(directSections.map((s) => s.id)).toContain(section.id);
    });

    it('detaches a Section, leaving it standalone', async () => {
      const group = await makeGroup('Detach Source Group');
      const section = await makeSection('Detach Target Section', group);

      const detached = await hierarchy.detachSection(section.id, em);

      expect(detached.parentGroup).toBeNull();
      const directSections = await hierarchy.listDirectSections(group.id, em);
      expect(directSections.map((s) => s.id)).not.toContain(section.id);
    });

    it('re-attaching a Section replaces its parent rather than adding a second one', async () => {
      const groupA = await makeGroup('Reattach Group A');
      const groupB = await makeGroup('Reattach Group B');
      const section = await makeSection('Reattach Section', groupA);

      const moved = await hierarchy.attachSection(section.id, groupB.id, em);

      expect(moved.parentGroup?.id).toBe(groupB.id);
      const groupAChildren = await hierarchy.listDirectSections(groupA.id, em);
      expect(groupAChildren.map((s) => s.id)).not.toContain(section.id);
    });
  });

  describe('attach / detach Group <-> Group', () => {
    it('attaches a standalone Group as a child of another Group', async () => {
      const parent = await makeGroup('Attach Child Parent');
      const child = await makeGroup('Attach Child Group');

      const attached = await hierarchy.attachChildGroup(
        child.id,
        parent.id,
        em,
      );

      expect(attached.parentGroup?.id).toBe(parent.id);
      const children = await hierarchy.listChildGroups(parent.id, em);
      expect(children.map((g) => g.id)).toContain(child.id);
    });

    it('detaches a child Group, making it a root Group again', async () => {
      const parent = await makeGroup('Detach Child Parent');
      const child = await makeGroup('Detach Child Group', parent);

      const detached = await hierarchy.detachChildGroup(child.id, em);

      expect(detached.parentGroup).toBeNull();
      const rootAncestors = await hierarchy.getAncestors(child.id, em);
      expect(rootAncestors).toEqual([]);
    });
  });

  it('a Group can contain both child Groups and Sections at the same time', async () => {
    const parent = await makeGroup('Mixed Children Parent');
    const childGroup = await makeGroup('Mixed Child Group', parent);
    const childSection = await makeSection('Mixed Child Section', parent);

    const children = await hierarchy.listChildGroups(parent.id, em);
    const sections = await hierarchy.listDirectSections(parent.id, em);

    expect(children.map((g) => g.id)).toEqual([childGroup.id]);
    expect(sections.map((s) => s.id)).toEqual([childSection.id]);
  });

  describe('cycle and parentage guards', () => {
    it('rejects attaching a Group as its own parent (self-parent)', async () => {
      const group = await makeGroup('Self Parent Group');

      await expect(
        hierarchy.attachChildGroup(group.id, group.id, em),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_SELF_PARENT' },
      });
    });

    it('rejects a direct two-node cycle (A -> B, then B -> A)', async () => {
      const a = await makeGroup('Cycle A');
      const b = await makeGroup('Cycle B', a);

      await expect(
        hierarchy.attachChildGroup(a.id, b.id, em),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_HIERARCHY_CYCLE' },
      });

      // The attempted cycle must not have partially applied.
      const reloadedA = await em.findOneOrFail(Group, { id: a.id });
      expect(reloadedA.parentGroup).toBeNull();
    });

    it('rejects a multi-level cycle (A -> B -> C, then C -> A)', async () => {
      const a = await makeGroup('Multi Cycle A');
      const b = await makeGroup('Multi Cycle B', a);
      const c = await makeGroup('Multi Cycle C', b);

      await expect(
        hierarchy.attachChildGroup(a.id, c.id, em),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_HIERARCHY_CYCLE' },
      });

      const reloadedA = await em.findOneOrFail(Group, { id: a.id });
      expect(reloadedA.parentGroup).toBeNull();
    });

    it('allows re-parenting a Group to an unrelated Group (not a cycle)', async () => {
      const oldParent = await makeGroup('Reparent Old Parent');
      const newParent = await makeGroup('Reparent New Parent');
      const child = await makeGroup('Reparent Child', oldParent);

      const moved = await hierarchy.attachChildGroup(
        child.id,
        newParent.id,
        em,
      );

      expect(moved.parentGroup?.id).toBe(newParent.id);
    });
  });

  describe('type immutability across attach/detach', () => {
    it('a Group stays a Group after being attached and detached', async () => {
      const parent = await makeGroup('Immutability Parent');
      const group = await makeGroup('Immutability Group');

      await hierarchy.attachChildGroup(group.id, parent.id, em);
      await hierarchy.detachChildGroup(group.id, em);

      const reloaded = await em.findOneOrFail(Group, { id: group.id });
      expect(reloaded).toBeInstanceOf(Group);
      const stillNotASection = await em.findOne(Section, { id: group.id });
      expect(stillNotASection).toBeNull();
    });

    it('a Section stays a Section after being attached and detached', async () => {
      const parent = await makeGroup('Immutability Section Parent');
      const section = await makeSection('Immutability Section');

      await hierarchy.attachSection(section.id, parent.id, em);
      await hierarchy.detachSection(section.id, em);

      const reloaded = await em.findOneOrFail(Section, { id: section.id });
      expect(reloaded).toBeInstanceOf(Section);
      const stillNotAGroup = await em.findOne(Group, { id: section.id });
      expect(stillNotAGroup).toBeNull();
    });
  });

  describe('findCommunityById / resolveRootGroup', () => {
    it('resolves a Group id to the Group instance', async () => {
      const group = await makeGroup('FindCommunity Group');
      const found = await hierarchy.findCommunityById(group.id, em);
      expect(found).toBeInstanceOf(Group);
      expect(found?.id).toBe(group.id);
    });

    it('resolves a Section id to the Section instance', async () => {
      const section = await makeSection('FindCommunity Section');
      const found = await hierarchy.findCommunityById(section.id, em);
      expect(found).toBeInstanceOf(Section);
      expect(found?.id).toBe(section.id);
    });

    it('returns null for an unknown id', async () => {
      const found = await hierarchy.findCommunityById(randomUUID(), em);
      expect(found).toBeNull();
    });

    it("resolves a Section's root Group by walking its parent Group chain", async () => {
      const root = await makeGroup('Resolve Root');
      const middle = await makeGroup('Resolve Middle', root);
      const section = await makeSection('Resolve Section', middle);

      const resolvedRoot = await hierarchy.resolveRootGroup(section, em);

      expect(resolvedRoot.id).toBe(root.id);
    });

    it('throws when resolving the root of a standalone Section with no parent', async () => {
      const section = await makeSection('Rootless Section');

      await expect(
        hierarchy.resolveRootGroup(section, em),
      ).rejects.toMatchObject({ response: { code: 'SECTION_HAS_NO_PARENT' } });
    });
  });
});
