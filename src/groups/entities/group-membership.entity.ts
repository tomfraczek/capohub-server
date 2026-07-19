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
import { GroupRole } from '../enums/group-role.enum';
import { Group } from './group.entity';

export const GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX =
  'group_memberships_group_id_user_id_active_unique';

// One row per stint a user has in a group - never reused/overwritten across
// a join/leave/rejoin cycle, so membership history is preserved (see the
// GroupMembershipStatus enum). Exactly one ACTIVE row may exist per
// (group, user) at a time - enforced application-side, transactionally, by
// GroupMembershipsService (the same way RhythmsService enforces "one primary
// rhythm per song", see group-membership.query.ts), *and* backed by this
// partial unique index as a database-level safety net against races. The
// `expression` form is required because a plain @Unique() cannot express the
// `WHERE status = 'ACTIVE'` predicate - MikroORM's schema comparator treats
// expression-based indexes as equal as long as the name matches, so this
// stays stable under `schema:diff` (see PostgreSqlSchemaHelper/SchemaComparator).
@Entity({ tableName: 'group_memberships' })
@Index({ properties: ['group', 'user', 'status'] })
@Unique({
  name: GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  properties: ['group', 'user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.group}", "${columns.user}") where ("${columns.status}" = 'ACTIVE')`,
})
export class GroupMembership extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'cascade' })
  group!: Group;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Enum({ items: () => Object.values(GroupRole) })
  role!: GroupRole;

  @Enum({ items: () => Object.values(GroupMembershipStatus) })
  status: GroupMembershipStatus = GroupMembershipStatus.ACTIVE;

  @Property({ type: 'timestamptz' })
  joinedAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  leftAt: Date | null = null;
}
