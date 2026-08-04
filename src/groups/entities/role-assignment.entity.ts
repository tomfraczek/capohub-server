import {
  Check,
  Entity,
  Index,
  ManyToOne,
  Enum,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { GroupRole } from '../enums/group-role.enum';
import { Group } from './group.entity';
import { Section } from './section.entity';

export const ROLE_ASSIGNMENTS_UNIQUE_INDEX =
  'role_assignments_user_id_group_id_role_unique';

export const ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX =
  'role_assignments_group_id_owner_unique';

// A Role, granted directly to a User, for exactly one Group (Root or Child)
// or one Section. No FK to any membership: authority for a Group-target
// row comes only from this row existing (Group has no membership at all);
// authority for a Section-target row additionally requires an active
// SectionMembership for the same (user, section), correlated by that
// composite key, never by a stored relation - see
// RoleAssignmentsService.resolveAuthorization. This also means a Group
// never inherits/loses authority through anything membership-shaped, since
// there is nothing to point at.
//
// A user may hold *multiple* Roles for the same target at once (e.g.
// MEMBER + INSTRUCTOR + ADMIN all at the same time on a Section) - each is
// its own row. The unique constraint below only prevents holding the *same*
// Role twice for the same (user, target) pair while active.
//
// `revokedAt`/`revokedBy` make this a soft-revoke, not a hard delete -
// needed to correctly disambiguate SectionMembership "stints": a user may
// leave and rejoin a Section many times, and a historical ADMIN grant from
// a since-ended stint must never silently regain authority just because the
// same (user, section) has a new, unrelated active membership later. A
// fresh RoleAssignment row is always inserted for a fresh grant instead of
// resurrecting an old one.
//
// `grantedBy`/`revokedBy` are optional and `set null` on delete: knowing
// who granted/revoked a Role is useful, but must never block or cascade
// from that actor's own account deletion, and cannot always be known for
// historical data (see the migration that introduces this shape).
//
// OWNER is the one Role that is not "just another Role" alongside the
// others: every Group/Section must have exactly one active OWNER -
// enforced by ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX, a partial unique index
// on `group`/`section` where `role = 'OWNER' and revoked_at is null`.
// Ownership moves only via an atomic transfer (revoke the previous OWNER
// row, insert a new one, same transaction - see
// SectionMembershipsService.transferOwnership) - the previous owner loses
// only the OWNER row; every other RoleAssignment they hold is untouched.
@Entity({ tableName: 'role_assignments' })
@Unique({
  name: ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  properties: ['user', 'group', 'section', 'role'],
  // `coalesce` folds the two nullable community FKs into one comparison
  // key, since exactly one of them is ever set for a given row. Partial on
  // `revoked_at is null` so a user may hold a fresh grant of a Role they
  // previously held and had revoked, without colliding with the historical
  // row.
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.user}", coalesce("${columns.group}", "${columns.section}"), "${columns.role}") where ("${columns.revokedAt}" is null)`,
})
@Unique({
  name: ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX,
  properties: ['group', 'section'],
  // Partial unique index (only active rows where role = OWNER).
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} (coalesce("${columns.group}", "${columns.section}")) where ("${columns.role}" = 'OWNER' and "${columns.revokedAt}" is null)`,
})
// Exactly one of `group`/`section` must be set, never both, never neither.
@Check<RoleAssignment>({
  name: 'role_assignments_group_or_section_check',
  expression: (columns) =>
    `("${columns.group}" is not null and "${columns.section}" is null) or ("${columns.group}" is null and "${columns.section}" is not null)`,
})
// Group only ever holds OWNER/ADMIN; Section may hold any of the 5 roles -
// enforced here, not just in service-layer validation, since a raw DB
// write must never be able to produce an invalid combination.
// Written as explicit OR-chains, not `role IN (...)`: Postgres always
// canonicalizes an IN-list into `= ANY (ARRAY[...])` when storing a CHECK
// constraint, which MikroORM's schema comparator does not reliably
// recognize as equivalent to the original expression - producing a
// perpetual, spurious diff in `schema:update --dump`. An OR-chain of `=`
// comparisons round-trips cleanly instead.
@Check<RoleAssignment>({
  name: 'role_assignments_role_matches_target_check',
  expression: (columns) =>
    `("${columns.group}" is not null and ("${columns.role}" = 'OWNER' or "${columns.role}" = 'ADMIN')) or ("${columns.section}" is not null and ("${columns.role}" = 'OWNER' or "${columns.role}" = 'ADMIN' or "${columns.role}" = 'INSTRUCTOR' or "${columns.role}" = 'ASSISTANT' or "${columns.role}" = 'MEMBER'))`,
})
export class RoleAssignment extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  // The Group-or-Section this Role Assignment targets, represented by two
  // nullable FKs (exactly one set).
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

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  grantedBy: User | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  revokedBy: User | null = null;
}
