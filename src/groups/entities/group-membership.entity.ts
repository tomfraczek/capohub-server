import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { MembershipEndReason } from '../enums/membership-end-reason.enum';
import { Group } from './group.entity';

export const GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX =
  'group_memberships_root_group_id_user_id_active_unique';

// One row per stint a user has in an organization (a Root Group) - never
// reused/overwritten across a join/leave/rejoin cycle, so membership
// history is preserved (see the GroupMembershipStatus enum). Exactly one
// ACTIVE row may exist per (rootGroup, user) at a time - enforced
// application-side, transactionally, by GroupMembershipsService (the same
// way RhythmsService enforces "one primary rhythm per song", see
// group-membership.query.ts), *and* backed by this partial unique index
// as a database-level safety net against races. The `expression` form is
// required because a plain @Unique() cannot express the
// `WHERE status = 'ACTIVE'` predicate - MikroORM's schema comparator
// treats expression-based indexes as equal as long as the name matches,
// so this stays stable under `schema:diff` (see
// PostgreSqlSchemaHelper/SchemaComparator).
//
// `rootGroup` must always reference an actual Root Group (a Group with no
// parent) - GroupMembershipsService validates this at creation time,
// since Membership represents participation in an organization as a
// whole, never in one specific Child Group (see
// organization-entities.md#membership). Like `parentGroupId` on Group,
// `rootGroup` is immutable after creation - there is no operation that
// moves a Membership to a different Root Group.
//
// Deliberately has no `role` field - Membership never stores a Role (see
// ADR-028). Which Role(s) a user holds, and in which specific Group, is
// answered entirely by RoleAssignment records that reference this
// Membership - see role-assignment.entity.ts.
@Entity({ tableName: 'group_memberships' })
@Index({ properties: ['rootGroup', 'user', 'status'] })
@Unique({
  name: GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  properties: ['rootGroup', 'user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.rootGroup}", "${columns.user}") where ("${columns.status}" = 'ACTIVE')`,
})
export class GroupMembership extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'cascade' })
  rootGroup!: Group;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Enum({ items: () => Object.values(GroupMembershipStatus) })
  status: GroupMembershipStatus = GroupMembershipStatus.ACTIVE;

  @Property({ type: 'timestamptz' })
  joinedAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  leftAt: Date | null = null;

  // Distinguishes a self-service leave from an administrator removing the
  // member - both end in status ARCHIVED (see GroupMembershipStatus), so
  // this is the only place that distinction survives. `null` until the
  // Membership is archived. Left as a plain field for now, ready to be
  // referenced by a future Audit Log entry rather than being the audit
  // trail itself.
  @Enum({ items: () => Object.values(MembershipEndReason), nullable: true })
  endReason: MembershipEndReason | null = null;
}
