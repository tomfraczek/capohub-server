import {
  Entity,
  Index,
  ManyToOne,
  Enum,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { GroupRole } from '../enums/group-role.enum';
import { Group } from './group.entity';
import { Section } from './section.entity';
import { GroupMembership } from './group-membership.entity';

export const ROLE_ASSIGNMENTS_UNIQUE_INDEX =
  'role_assignments_membership_id_group_id_role_unique';

export const ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX =
  'role_assignments_group_id_owner_unique';

// A Role, granted to a Membership, for exactly one Group (Root or Child) -
// entirely independent of Membership's own fields (see ADR-028: Variant B).
// Role is a fixed system enum (GroupRole) - never organization-defined.
//
// A Membership may hold *multiple* Roles for the same Group at once (e.g.
// MEMBER + INSTRUCTOR + ADMIN all at the same time) - each is its own row.
// The unique constraint below only prevents holding the *same* Role twice
// for the same (Membership, Group) pair; it does not limit how many
// distinct Roles a Membership may hold there. Effective permissions for a
// Group are the union of every currently-active RoleAssignment's
// permissions (see GroupPermissionService.hasAllPermissionsForRoles) - not
// a single Role lookup.
//
// No `status` field: a RoleAssignment has no independent lifecycle state of
// its own. Whether it currently grants authority is resolved dynamically by
// checking its Membership's status (ACTIVE/READ_ONLY/INVITED/ARCHIVED) at
// evaluation time - see GroupPermissionsGuard. "Changing" a specific Role
// Assignment (via RoleAssignmentsService.changeRole) updates `role` on that
// one row in place; granting an additional Role creates a new, separate
// row; revoking a Role is a hard delete of that one row - there is no
// documented requirement to keep a history of past Roles.
//
// OWNER is the one Role that is not "just another Role" alongside the
// others: every Group must have exactly one active OWNER (see ADR-028) -
// enforced by ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX, a partial unique index
// on `group` where `role = 'OWNER'`, independent of which Membership holds
// it. Ownership moves only via an atomic transfer (delete the previous
// OWNER row, insert a new one, same transaction - see
// GroupMembershipsService.transferOwnership) - the previous owner loses
// only the OWNER row; every other RoleAssignment they hold is untouched.
//
// No delete cascade on either FK - Membership and Group are archived, never
// physically deleted (ADR-007), so there is never a delete to cascade from
// in practice.
@Entity({ tableName: 'role_assignments' })
@Unique({
  name: ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  properties: ['membership', 'group', 'section', 'role'],
  // `coalesce` folds the two nullable community FKs into one comparison
  // key, since exactly one of them is ever set for a given row (see the
  // Group/Section physical-split ADR).
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.membership}", coalesce("${columns.group}", "${columns.section}"), "${columns.role}")`,
})
@Unique({
  name: ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX,
  properties: ['group', 'section'],
  // Partial unique index (only rows where role = OWNER) - same `expression`
  // technique as GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX, required because a
  // plain @Unique() cannot express a WHERE predicate.
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} (coalesce("${columns.group}", "${columns.section}")) where ("${columns.role}" = 'OWNER')`,
})
export class RoleAssignment extends BaseEntity {
  @Index()
  @ManyToOne(() => GroupMembership)
  membership!: GroupMembership;

  // The Group-or-Section this Role Assignment targets, represented by two
  // nullable FKs (exactly one set) since the Group/Section physical split -
  // see GroupHierarchyService.findCommunityById for resolving whichever one
  // is populated.
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  group: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'no action' })
  section: Section | null = null;

  @Enum({ items: () => Object.values(GroupRole) })
  role!: GroupRole;

  @Property({ type: 'timestamptz' })
  grantedAt: Date = new Date();
}
