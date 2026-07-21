import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Group } from './entities/group.entity';
import { GroupStatus } from './enums/group-status.enum';

/**
 * Owns every Group hierarchy rule (see organization-domain.md#hierarchy and
 * ADR-002): finding a Group's Root Group, walking ancestors/descendants, and
 * validating a parent before it is attached at creation time.
 * `parentGroup` must never be mutated outside this service.
 *
 * The one rule that shapes this service: `parentGroup` is fixed at creation
 * and never changes afterward. There is no attach/detach/move operation -
 * once a Group is created, its position in the hierarchy (and therefore its
 * Root Group) is permanent.
 */
@Injectable()
export class GroupHierarchyService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Walks `parentGroup` up to the top. Returns the Group itself if it is
   * already a Root Group. `visited` guards against corrupt/cyclic data
   * that could only exist if something bypassed this service.
   *
   * Accepts an optional `em` so callers running inside their own
   * `em.transactional(...)` callback can pass that forked EntityManager
   * through, instead of this falling back to `this.em` - reaching for a
   * second EntityManager from inside someone else's transaction risks the
   * same connection-pool deadlock class described on
   * GroupHierarchyService.moveGroup's (removed) history.
   */
  async getRootGroup(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group> {
    return this.resolveRootGroup(em, groupId);
  }

  /**
   * Ancestors ordered from the Root Group down to the immediate parent
   * (root-first). Empty array for a Root Group.
   */
  async getAncestors(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group[]> {
    const group = await this.loadOrFail(em, groupId);
    const ancestors: Group[] = [];
    const visited = new Set<string>([group.id]);

    let parentRef = group.parentGroup;
    while (parentRef) {
      const parent = await this.loadOrFail(em, parentRef.id);
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
   * Every descendant of the Group, at any depth, in no particular order.
   * Breadth-first over `parentGroup` - simple and correct; if this becomes
   * a hot path, it can be replaced by a recursive CTE without changing the
   * method's contract (see organization-domain.md#performance: correctness
   * first, optimize later).
   */
  async getDescendants(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group[]> {
    await this.loadOrFail(em, groupId);

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
   * Loads and validates a candidate parent for a new Group at creation
   * time. Structural existence/status checks only - authorization (does the
   * caller have permission to attach something under this parent) is the
   * caller's responsibility.
   */
  async assertParentIsUsable(
    parentGroupId: string,
    em: EntityManager = this.em,
  ): Promise<Group> {
    return this.resolveUsableParent(em, parentGroupId);
  }

  private async resolveRootGroup(
    em: EntityManager,
    groupId: string,
  ): Promise<Group> {
    let current = await this.loadOrFail(em, groupId);
    const visited = new Set<string>([current.id]);

    while (current.parentGroup) {
      const parent = await this.loadOrFail(em, current.parentGroup.id);
      if (visited.has(parent.id)) {
        throw this.cycleDetected();
      }
      visited.add(parent.id);
      current = parent;
    }

    return current;
  }

  private async resolveUsableParent(
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

  private async loadOrFail(em: EntityManager, groupId: string): Promise<Group> {
    const group = await em.findOne(Group, { id: groupId });
    if (!group) {
      throw this.groupNotFound();
    }
    return group;
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  private cycleDetected(): ConflictException {
    return new ConflictException({
      code: 'GROUP_HIERARCHY_CYCLE',
      message: 'A cycle was detected in the group hierarchy',
    });
  }
}
