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
import { EventRole } from '../enums/event-role.enum';
import { Event } from './event.entity';

export const EVENT_ROLE_ASSIGNMENTS_UNIQUE_INDEX =
  'event_role_assignments_event_id_user_id_role_unique';
export const EVENT_ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX =
  'event_role_assignments_event_id_owner_unique';

// Event administrative roles are a deliberately separate concept from
// Community roles (GroupRole/RoleAssignment) - see the Events spec
// ("Oddziel role administracyjne Eventu od ról Community"). Holding a Role
// here says nothing about the user's Community role, and vice versa: an
// Organizer/Moderator need not be a Community Admin, and a Community
// Admin/Owner gets no Event authority automatically (except the narrow,
// explicit GroupPermission.EVENT_MODERATE override - see
// events/permissions/event-permission.enum.ts).
//
// Keyed directly by (event, user, role) - unlike RoleAssignment, which is
// keyed through a GroupMembership - because Event roles are not scoped to
// an ongoing Community membership: Organizer/Moderator do not have to be
// participants of the Event (their own RSVP/EventAttendee row, if any, is
// entirely independent - see EventAttendee), and this codebase has no
// generic "membership" concept at the Event level to key through. Whether
// the target user actually belongs to the Event's Community is validated
// once, at grant time, by EventRolesService (mirroring the Root-Group
// check RoleAssignmentsService.grantRole performs) - it is not
// continuously re-verified, so an Event role does not silently evaporate
// if the holder later leaves the Community (a deliberate simplification -
// see ADR-019: no automatic relationships/side effects).
//
// A user may hold more than one Role for the same Event at once (mirrors
// RoleAssignment/GroupRole) - effective permissions are the union of every
// held Role's permissions (see EventPermissionService).
//
// No `status`/expiry field: unlike GroupRole, an Event Role's authority is
// not resolved dynamically against anything else - it is either present
// (grantable/revocable) or it is not.
@Entity({ tableName: 'event_role_assignments' })
@Unique({
  name: EVENT_ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  properties: ['event', 'user', 'role'],
})
@Unique({
  name: EVENT_ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX,
  properties: ['event'],
  // Partial unique index (only rows where role = OWNER) - same technique as
  // ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX: every Event must have exactly one
  // active OWNER at all times.
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.event}") where ("${columns.role}" = 'OWNER')`,
})
export class EventRoleAssignment extends BaseEntity {
  @Index()
  @ManyToOne(() => Event, { deleteRule: 'no action' })
  event!: Event;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'no action' })
  user!: User;

  @Enum({ items: () => Object.values(EventRole) })
  role!: EventRole;

  @Property({ type: 'timestamptz' })
  grantedAt: Date = new Date();

  // `set null` on delete (unlike `user`/`event` above, which never cascade
  // - see ADR-007): the granting admin's own account may be physically
  // deleted independently of a Role they granted to someone else in the
  // past.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  grantedBy: User | null = null;
}
