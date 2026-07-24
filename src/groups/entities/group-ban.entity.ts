import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Group } from './group.entity';

export const GROUP_BANS_ACTIVE_UNIQUE_INDEX =
  'group_bans_root_group_id_user_id_active_unique';

// A durable record that a User is banned from an Organization (Root Group),
// independent of any GroupMembership row - a ban must still block rejoining
// even though the Membership it ended is, like every Membership, never
// physically deleted and stays ARCHIVED forever (ADR-007). Scoped to the
// Root Group only, mirroring Membership's own scope (ADR-004: Membership
// only exists at the Organization level) - there is no per-Child-Group ban,
// since removing someone from a Child Group specifically is already fully
// covered by revoking their Role Assignment there
// (RoleAssignmentsService.revokeRole); what a ban adds beyond that is
// exclusively the "block future rejoining" guarantee, which only has
// meaning at the level where joining itself is defined (the Organization).
//
// `liftedAt === null` means the ban is currently active. Unbanning sets
// `liftedAt`/`liftedBy` rather than deleting the row, so a lifted ban still
// exists as history - consistent with every other soft-delete/no-physical-
// removal policy in this module (ADR-007). A user banned again after being
// unbanned gets a brand new row, never a reused one - the same
// never-reused-history principle as GroupMembership.
//
// `user`/`bannedBy`/`liftedBy` are all `set null` on delete (nullable even
// though `user`/`bannedBy` are always populated at creation) - unlike
// GroupMembership.user (`cascade`, see UserService.deleteLocalAccountData),
// a User account can be physically deleted (DELETE /users/me) independent
// of any ban record that references them, either as the banned party or as
// the admin who banned/unbanned someone else. Nulling the reference instead
// of blocking the delete (or cascading the ban row away) preserves the ban
// as history without resurrecting the no-longer-existing account.
@Entity({ tableName: 'group_bans' })
@Unique({
  name: GROUP_BANS_ACTIVE_UNIQUE_INDEX,
  properties: ['rootGroup', 'user'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.rootGroup}", "${columns.user}") where ("${columns.liftedAt}" is null)`,
})
export class GroupBan extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  rootGroup!: Group;

  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  user: User | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  bannedBy: User | null = null;

  @Property({ type: 'timestamptz' })
  bannedAt: Date = new Date();

  @Property({ nullable: true, type: 'text' })
  reason: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  liftedAt: Date | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  liftedBy: User | null = null;
}
