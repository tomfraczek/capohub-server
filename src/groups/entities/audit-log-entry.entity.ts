import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { User } from '../../users/entities/user.entity';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditTargetType } from '../enums/audit-target-type.enum';
import { Group } from './group.entity';

// Deliberately does NOT extend BaseEntity: an audit log entry is immutable
// once written (no `updatedAt` makes sense for a fact that, by definition,
// never changes after it happened) - see AuditLogService.record(), the only
// place that ever creates a row here, and organization-domain.md#auditability.
//
// One entity for every action type (see AuditAction), not a table per
// action - this is what lets GET /groups/:groupId/audit-log be a single,
// generic, paginated/filterable/sortable endpoint (see AuditLogController)
// instead of 21 separate ones.
//
// `community` is always the Root Group the event is filed under - even for
// an action on a Child Group (e.g. CREATE_CHILD_GROUP, ADD_ROLE for a Child
// Group's Role Assignment), so that "this Organization's Audit Log" is a
// single, complete query regardless of which exact Group within it was
// acted on. No delete cascade: Groups/Users are soft-deleted, never
// physically removed (ADR-007), so a Group being archived/deleted must not
// silently erase its own history.
@Entity({ tableName: 'audit_log_entries' })
export class AuditLogEntry {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  community!: Group;

  @Index()
  @Enum({ items: () => Object.values(AuditAction) })
  action!: AuditAction;

  // The user who performed the action. Nullable both for a future
  // system-initiated entry, and - just as importantly - because the actor's
  // User account can be physically deleted later (DELETE /users/me) while
  // this entry must survive forever (ADR-007/immutability, see class
  // comment) - `set null` on delete anonymizes the entry rather than
  // blocking the account deletion or destroying the historical record.
  // Lazy suspension expiry, for instance, is deliberately NOT audit-logged
  // at all, since it is not an actor performing UNSUSPEND, just a
  // permission check noticing `until` has passed (see MembershipSuspension).
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  actor: User | null = null;

  @Enum({ items: () => Object.values(AuditTargetType), nullable: true })
  targetType: AuditTargetType | null = null;

  // The id of whatever `targetType` names - a User id, a RoleAssignment id,
  // a MembershipRequest id, or the community's own Group id for
  // community-level actions (CREATE_COMMUNITY, UPDATE_COMMUNITY, ARCHIVE,
  // RESTORE, DELETE). Left untyped as a plain string (no FK) since it can
  // point at different tables depending on targetType, and the target row
  // itself may later be soft-deleted/archived - the audit entry must
  // survive that regardless.
  @Property({ nullable: true, type: 'uuid' })
  targetId: string | null = null;

  // Short, human-readable summary (e.g. "Ana Silva removed Bruno Costa from
  // the organization") - optional because some actions are fully
  // self-explanatory from action + target alone.
  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  // Structured extra data specific to the action (e.g. { role: "ADMIN" } for
  // ADD_ROLE/REMOVE_ROLE, { previousOwnerId, newOwnerId } for
  // TRANSFER_OWNERSHIP, { until, reason } for SUSPEND). Optional, action-
  // dependent - never relied upon by generic list/filter/sort logic, which
  // only ever queries the typed columns above.
  @Property({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null = null;

  @Index()
  @Property({ type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
