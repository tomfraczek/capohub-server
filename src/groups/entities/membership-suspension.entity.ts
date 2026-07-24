import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { GroupMembership } from './group-membership.entity';

export const MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX =
  'membership_suspensions_membership_id_active_unique';

// Records a single suspension of a GroupMembership - suspending sets
// Membership.status to READ_ONLY (see organization-entities.md#membership:
// "READ_ONLY ... e.g. suspended member"), which the existing permission
// system (GroupPermissionService.hasAllPermissionsForRoles,
// READ_ONLY_SAFE_PERMISSIONS) already resolves correctly with no further
// change - a suspended member, regardless of Role, keeps only the *_VIEW
// tier of permissions, the same as any other READ_ONLY Membership. This
// entity exists to capture the *specific* suspension's who/when/why/until,
// which the bare `status` field cannot - a Membership can be suspended,
// unsuspended, and suspended again multiple times across one continuous
// stint, and each occurrence must remain visible in the Audit Log.
//
// `until` is nullable - a null value means an indefinite suspension that
// only ends via an explicit Unsuspend. There is no background job that
// flips `status` back to ACTIVE at `until` (this codebase has no scheduler
// infrastructure) - expiry is resolved lazily instead: the next time this
// Membership's authorization is resolved
// (RoleAssignmentsService.resolveAuthorization), an `until` in the past is
// detected and the Membership/suspension are reconciled back to
// ACTIVE/lifted in that same call, before the permission check runs. Until
// that next resolution happens, `status` may still literally read
// READ_ONLY even though `until` has passed - this is a deliberate,
// documented trade-off, not a bug.
//
// `liftedAt === null` (and, dynamically, `until` still in the future or
// null) means the suspension is currently in effect.
//
// `membership` is `cascade` on delete - unlike GroupBan (independent of any
// Membership row), a suspension record has no meaning once its own
// Membership is gone. GroupMembership rows are hard-deleted only via
// UserService.deleteLocalAccountData, which already deletes every
// RoleAssignment for that Membership explicitly before deleting it; letting
// this FK cascade the same way avoids a third explicit nativeDelete call for
// what is, unlike RoleAssignment, a purely incidental detail record - the
// SUSPEND/UNSUSPEND facts themselves are preserved forever, independently,
// in AuditLogEntry.
//
// `suspendedBy`/`liftedBy` are `set null` on delete, same reasoning as
// GroupBan.bannedBy/liftedBy - the admin who suspended/unsuspended someone
// may later delete their own account independent of this record.
@Entity({ tableName: 'membership_suspensions' })
@Unique({
  name: MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX,
  properties: ['membership'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.membership}") where ("${columns.liftedAt}" is null)`,
})
export class MembershipSuspension extends BaseEntity {
  @Index()
  @ManyToOne(() => GroupMembership, { deleteRule: 'cascade' })
  membership!: GroupMembership;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  suspendedBy: User | null = null;

  @Property({ type: 'timestamptz' })
  suspendedAt: Date = new Date();

  // Null = indefinite, requires an explicit Unsuspend.
  @Property({ type: 'timestamptz', nullable: true })
  until: Date | null = null;

  @Property({ nullable: true, type: 'text' })
  reason: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  liftedAt: Date | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  liftedBy: User | null = null;
}
