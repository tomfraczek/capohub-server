import {
  Check,
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { HierarchyInvitationStatus } from '../enums/hierarchy-invitation-status.enum';
import { Group } from './group.entity';
import { Section } from './section.entity';

export const HIERARCHY_INVITATION_PENDING_UNIQUE_IDX =
  'hierarchy_invitations_pending_relation_unique';

// Proposes attaching `targetGroup`/`targetSection` (exactly one set) as a
// child of `parentGroup` - the mechanism for when the inviting actor
// manages `parentGroup` (holds HIERARCHY_INVITE there) but does not control
// the target (no HIERARCHY_MANAGE there), so a direct attach is not
// available to them (see GroupHierarchyService.attachChildGroup/
// attachSection, which direct attach uses instead). Sending an invitation
// never mutates the hierarchy by itself - only the target's own OWNER,
// accepting, does that (see HierarchyManagementService.acceptInvitation,
// which performs the actual attach in the same transaction as this row's
// status change).
//
// Only a Group may be a parent (Section can never have children - see
// GroupHierarchyService) - `parentGroup` is therefore always a Group,
// never a Section.
//
// Deliberately a separate domain from MembershipRequest: this proposes a
// structural relationship between two organizational entities, never a
// user joining/being invited into one, and never grants any Role or
// membership by itself.
@Entity({ tableName: 'hierarchy_invitations' })
@Unique({
  name: HIERARCHY_INVITATION_PENDING_UNIQUE_IDX,
  properties: ['parentGroup', 'targetGroup', 'targetSection'],
  // `coalesce` folds the two nullable target FKs into one comparison key,
  // since exactly one is ever set for a given row - mirrors
  // MembershipRequest's own pending-uniqueness indexes. Partial on
  // status = 'PENDING' so a terminal (accepted/rejected/cancelled)
  // invitation never blocks a fresh one for the same relation.
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.parentGroup}", coalesce("${columns.targetGroup}", "${columns.targetSection}")) where ("${columns.status}" = 'PENDING')`,
})
// Exactly one of `targetGroup`/`targetSection` must be set, never both,
// never neither - same XOR pattern as RoleAssignment/MembershipRequest.
@Check<HierarchyInvitation>({
  name: 'hierarchy_invitations_target_group_or_section_check',
  expression: (columns) =>
    `("${columns.targetGroup}" is not null and "${columns.targetSection}" is null) or ("${columns.targetGroup}" is null and "${columns.targetSection}" is not null)`,
})
// A Group can never invite itself as its own child. Postgres treats a NULL
// comparison as satisfying a CHECK, so this is a no-op (always passes) for
// Section-target rows, where the self-parent case cannot occur regardless
// (a Section's id can never equal a Group's id). Cycle-freedom for a Group
// target beyond this direct case (target is an *ancestor* of the parent,
// not the parent itself) cannot be expressed as a static CHECK - it is
// enforced at the service layer, both when the invitation is created and
// again when it is accepted (see HierarchyManagementService).
@Check<HierarchyInvitation>({
  name: 'hierarchy_invitations_no_self_parent_check',
  expression: (columns) =>
    `"${columns.parentGroup}" <> "${columns.targetGroup}"`,
})
export class HierarchyInvitation extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  parentGroup!: Group;

  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  targetGroup: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'no action' })
  targetSection: Section | null = null;

  // The actor who sent this invitation. Nullable/`set null` on delete -
  // knowing who invited is useful, but must never block or cascade from
  // that actor's own account deletion (mirrors RoleAssignment.grantedBy).
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  invitedBy: User | null = null;

  @Enum({ items: () => Object.values(HierarchyInvitationStatus) })
  status: HierarchyInvitationStatus = HierarchyInvitationStatus.PENDING;

  @Property({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null = null;

  // Whoever moved this row out of PENDING: the target's OWNER (accept/
  // reject) or an actor holding HIERARCHY_INVITE on the parent (cancel).
  // Same `set null` policy as `invitedBy`.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  respondedBy: User | null = null;
}
