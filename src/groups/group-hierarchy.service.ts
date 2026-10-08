import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { GroupStatus } from './enums/group-status.enum';

// Group and Section are two distinct, physically-stored entity types. This
// union only ever appears where a caller genuinely accepts either kind
// (e.g. a RoleAssignment or an Announcement's target) - the type itself
// never changes for a given row: a Section can never become a Group and
// vice versa. Attach/detach only ever moves a row's *position* in the
// hierarchy, never its kind.
export type Community = Group | Section;

/**
 * Builds the `{ group: id }` or `{ section: id }` fragment of a
 * MikroORM `FilterQuery` for whichever kind `community` actually is - the
 * query-side counterpart to the dual-nullable-FK pattern used by every
 * entity that references "a Group or a Section" (RoleAssignment, Academy,
 * Cohort, RecipientGroup, MembershipRequest, Announcement, Event). Shared
 * here so each of those modules queries "by community" the same way,
 * rather than re-deriving this branch itself.
 */
export function communityFilter(
  community: Community,
): { group: string } | { section: string } {
  return community instanceof Section
    ? { section: community.id }
    : { group: community.id };
}

/**
 * Same idea as communityFilter, but for querying "by community id" when
 * only the id is known (not which table it lives in) - matches whichever
 * of the two nullable FKs is set. IDs are unique across `groups` and
 * `sections` by construction, so this is never ambiguous.
 */
export function communityIdFilter(id: string): {
  $or: [{ group: string }, { section: string }];
} {
  return { $or: [{ group: id }, { section: id }] };
}

/**
 * The single owner of every hierarchy rule for Group <-> Group and
 * Group <-> Section relationships: resolving a Group's root, walking
 * ancestors/descendants, validating a parent, and performing every
 * attach/detach mutation. `parentGroup` on both Group and Section must
 * never be assigned outside this service, so cycle-freedom and every other
 * hierarchy invariant stay centrally enforced and are never duplicated in a
 * controller.
 *
 * Invariants enforced here - the hierarchy is a flat `Group -> Section`
 * tree:
 *  - A Group is always top-level: no new Group -> Group link can be
 *    created (rejectGroupAsChild, GROUP_CANNOT_HAVE_PARENT). Group -> Group
 *    nesting used to be allowed (organizational-domain rebuild, stage 1);
 *    legacy rows that still carry a `parentGroup` stay readable (the
 *    ancestor/descendant walks below keep working on them, cycle-guarded)
 *    and detachable, nothing more.
 *  - A Group may have any number of Sections.
 *  - A Section may have at most one parent Group (a single FK) and may
 *    never have children of any kind. Joining a Group through a
 *    HierarchyInvitation additionally requires the Section to be standalone
 *    (assertSectionIsStandalone).
 */
@Injectable()
export class GroupHierarchyService {
  constructor(private readonly em: EntityManager) {}

  // ---------------------------------------------------------------------
  // Group <-> Group hierarchy
  // ---------------------------------------------------------------------

  /**
   * Walks `parentGroup` up to the top. Returns the Group itself if it is
   * already a root. `visited` guards against corrupt/cyclic data that could
   * only exist if something bypassed this service.
   */
  async getRootGroup(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group> {
    const start = await this.loadGroupOrFail(em, groupId);
    return this.walkToRoot(em, start);
  }

  /**
   * Ancestors ordered from the root Group down to the immediate parent
   * (root-first). Empty array for a root Group.
   */
  async getAncestors(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group[]> {
    const group = await this.loadGroupOrFail(em, groupId);
    const ancestors: Group[] = [];
    const visited = new Set<string>([group.id]);

    let parentRef = group.parentGroup;
    while (parentRef) {
      const parent = await this.loadGroupOrFail(em, parentRef.id);
      if (visited.has(parent.id)) {
        throw this.cycleDetected();
      }
      visited.add(parent.id);
      ancestors.unshift(parent);
      parentRef = parent.parentGroup;
    }

    return ancestors;
  }

  /**
   * Every descendant Group of `groupId`, at any depth, in no particular
   * order. Sections are not included - use listDirectSections /
   * getDescendantSections for those. Breadth-first over `parentGroup`.
   */
  async getDescendants(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group[]> {
    await this.loadGroupOrFail(em, groupId);

    const descendants: Group[] = [];
    let frontier = [groupId];

    while (frontier.length > 0) {
      const children = await em.find(Group, {
        parentGroup: { $in: frontier },
      });
      descendants.push(...children);
      frontier = children.map((child) => child.id);
    }

    return descendants;
  }

  /**
   * Every Section anywhere under `groupId`'s subtree - the Group's own
   * direct Sections plus every descendant Group's direct Sections. Used
   * anywhere a caller needs "every Section this Group hierarchy contains",
   * not just one level down (see listDirectSections).
   */
  async getDescendantSections(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Section[]> {
    const descendantGroups = await this.getDescendants(groupId, em);
    const groupIds = [groupId, ...descendantGroups.map((group) => group.id)];
    return em.find(Section, { parentGroup: { $in: groupIds } });
  }

  /** Direct child Groups only (one level down), in no particular order. */
  async listChildGroups(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group[]> {
    await this.loadGroupOrFail(em, groupId);
    return em.find(Group, { parentGroup: groupId });
  }

  /** Direct Sections only (one level down), in no particular order. */
  async listDirectSections(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Section[]> {
    await this.loadGroupOrFail(em, groupId);
    return em.find(Section, { parentGroup: groupId });
  }

  /**
   * Loads and validates a candidate parent Group - structural
   * existence/status checks only. Authorization (does the caller have
   * permission to attach something under this parent) is the caller's
   * responsibility.
   */
  async assertParentIsUsable(
    parentGroupId: string,
    em: EntityManager = this.em,
  ): Promise<Group> {
    return this.resolveUsableParentGroup(em, parentGroupId);
  }

  /**
   * Groups are always top-level (see the class comment) - there is no
   * Group -> Group attach primitive any more. Every entry point that would
   * make a Group someone's child (direct POST /groups/:id/parent, creating
   * or accepting a HierarchyInvitation that targets a Group) calls this, so
   * they all reject with the same stable code.
   */
  rejectGroupAsChild(): never {
    throw this.groupCannotHaveParent();
  }

  /**
   * Detaches `childId` from its current parent, making it a root Group.
   * Kept only for legacy Group -> Group rows created before Groups became
   * strictly top-level - it is the one way to clean such a row up.
   */
  async detachChildGroup(
    childId: string,
    em: EntityManager = this.em,
  ): Promise<Group> {
    const child = await this.loadGroupOrFail(em, childId);
    child.parentGroup = null;
    await em.flush();
    return child;
  }

  /**
   * Dry-run counterpart for a Section target - a Section can never be an
   * ancestor of anything (it can never have children), so there is no
   * cycle to check beyond the parent Group itself existing and being
   * usable (not archived).
   */
  async assertCanAttachSection(
    parentGroupId: string,
    em: EntityManager = this.em,
  ): Promise<void> {
    await this.resolveUsableParentGroup(em, parentGroupId);
  }

  /**
   * Rejects a Section that already belongs to a Group. Used wherever a
   * Section joins a Group through a HierarchyInvitation (both when the
   * invitation is created and, authoritatively, when it is accepted) - an
   * invitation may only ever attach a standalone Section, never silently
   * move it away from its current Group. Moving an attached Section is a
   * separate, explicit operation (POST /sections/:id/parent, which requires
   * HIERARCHY_MANAGE on both the Section and the new parent), or a detach
   * followed by a fresh invitation.
   */
  assertSectionIsStandalone(section: Section): void {
    if (section.parentGroup) {
      throw new ConflictException({
        code: 'SECTION_ALREADY_HAS_PARENT',
        message: 'This section already belongs to a group',
      });
    }
  }

  /**
   * Attaches `sectionId` under `groupId`. A Section can only ever be
   * attached to a Group (never to another Section), and can never itself
   * gain children - both are structural, not just validated here: nothing
   * in this service accepts a Section id as a parent.
   */
  async attachSection(
    sectionId: string,
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Section> {
    const section = await this.loadSectionOrFail(em, sectionId);
    const group = await this.resolveUsableParentGroup(em, groupId);
    section.parentGroup = group;
    await em.flush();
    return section;
  }

  /** Detaches `sectionId` from its Group, leaving it standalone. */
  async detachSection(
    sectionId: string,
    em: EntityManager = this.em,
  ): Promise<Section> {
    const section = await this.loadSectionOrFail(em, sectionId);
    section.parentGroup = null;
    await em.flush();
    return section;
  }

  // ---------------------------------------------------------------------
  // Group-or-Section lookups, used by modules that reference "either kind"
  // (e.g. RoleAssignment, Announcement) - kept here rather than duplicated
  // in each of those modules.
  // ---------------------------------------------------------------------

  /** Looks up `id` in `groups` first, then `sections`. */
  async findCommunityById(
    id: string,
    em: EntityManager = this.em,
  ): Promise<Community | null> {
    const group = await em.findOne(Group, { id });
    if (group) {
      return group;
    }
    return em.findOne(Section, { id });
  }

  /**
   * Resolves the root Group "above" any Community (Group or Section). For a
   * Section, that means its parent Group's own root; a standalone Section
   * (no parent yet) has no root Group and this throws.
   */
  async resolveRootGroup(
    community: Community,
    em: EntityManager = this.em,
  ): Promise<Group> {
    if (community instanceof Section) {
      if (!community.parentGroup) {
        throw this.sectionHasNoParent();
      }
      return this.getRootGroup(community.parentGroup.id, em);
    }
    return this.getRootGroup(community.id, em);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async walkToRoot(em: EntityManager, start: Group): Promise<Group> {
    let current = start;
    const visited = new Set<string>([current.id]);

    while (current.parentGroup) {
      const parent = await this.loadGroupOrFail(em, current.parentGroup.id);
      if (visited.has(parent.id)) {
        throw this.cycleDetected();
      }
      visited.add(parent.id);
      current = parent;
    }

    return current;
  }

  private async resolveUsableParentGroup(
    em: EntityManager,
    parentGroupId: string,
  ): Promise<Group> {
    const parent = await em.findOne(Group, { id: parentGroupId });
    if (!parent) {
      throw new NotFoundException({
        code: 'GROUP_PARENT_NOT_FOUND',
        message: 'The parent group does not exist',
      });
    }

    if (parent.status === GroupStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'GROUP_ARCHIVED',
        message: 'This group is archived and is read-only until it is restored',
      });
    }

    return parent;
  }

  private async loadGroupOrFail(
    em: EntityManager,
    groupId: string,
  ): Promise<Group> {
    const group = await em.findOne(Group, { id: groupId });
    if (!group) {
      throw this.groupNotFound();
    }
    return group;
  }

  private async loadSectionOrFail(
    em: EntityManager,
    sectionId: string,
  ): Promise<Section> {
    const section = await em.findOne(Section, { id: sectionId });
    if (!section) {
      throw this.sectionNotFound();
    }
    return section;
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  private sectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
  }

  private groupCannotHaveParent(): ConflictException {
    return new ConflictException({
      code: 'GROUP_CANNOT_HAVE_PARENT',
      message: 'A group is always top-level and cannot belong to another group',
    });
  }

  private cycleDetected(): ConflictException {
    return new ConflictException({
      code: 'GROUP_HIERARCHY_CYCLE',
      message: 'A cycle was detected in the group hierarchy',
    });
  }

  private sectionHasNoParent(): ConflictException {
    return new ConflictException({
      code: 'SECTION_HAS_NO_PARENT',
      message: 'This section has no parent group',
    });
  }
}
