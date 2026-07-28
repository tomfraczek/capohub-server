# ADR-030: Events Module Architecture (Role Tier, History, Children Integration)

## Status

Accepted

## Context

The Events module needed three architectural decisions that were not
settled by the existing codebase and were not fully specified by the
product brief:

1. **Administrative roles.** The spec explicitly requires Event
   Owner/Organizer/Moderator to be separate from Community roles
   (`GroupRole`/`RoleAssignment`). The existing `RoleAssignment` entity is
   keyed through `GroupMembership` and is hard-wired to `Group` as its only
   target (see [ADR-028](ADR-028-role-assignment-model.md)) - it cannot be
   reused for a second, independent aggregate without breaking its own
   invariants (the OWNER-per-Group partial unique index, the
   membership-status-based authority resolution).
2. **Lifecycle history.** The spec requires Draft/Published/Cancelled/
   Finished history to be preserved. `AuditLogEntry` already supports a
   generic `(targetType, targetId)` reference and could, in principle, be
   extended with `AuditTargetType.EVENT` and new `AuditAction` values.
3. **Children.** The spec requires registering a parent's children (with
   or without their own account) for an Event, and assumes "a parent has a
   list of their children" already exists somewhere. No parent -> child
   relationship, and no Children/Family module, exists anywhere in this
   codebase today.

## Decision

### 1. A separate `EventRoleAssignment` entity, keyed by `(event, user, role)`

`EventRoleAssignment` is a new, independent entity - not a reuse or
extension of `RoleAssignment`. It is keyed directly by `(Event, User,
Role)`, not through a membership-like record, because Organizer/Moderator
do not have to be participants of the Event and this codebase has no
"membership in an Event" concept to key through. A parallel permission
system (`EventPermission`, `EVENT_ROLE_PERMISSIONS`,
`EventPermissionService`, `EventPermissionsGuard`) mirrors the Group one
exactly (tiered permission sets, a partial unique index enforcing exactly
one active OWNER, an atomic `transferOwnership`), so the two systems stay
structurally consistent without being the same system.

A narrow, explicit bridge exists in the other direction: creating an Event
still requires a **Community** permission
(`GroupPermission.EVENT_CREATE`, Community Admin/Owner tier), and a new
`GroupPermission.EVENT_MODERATE` gives Community Admin/Owner a
deliberately narrow oversight override (cancel any Event under their
community) so a community is never held hostage by an unresponsive or
departed Event Owner. This override was not requested explicitly by the
spec; it was added as a scoped, defensible judgment call, not a general
escape hatch (`EVENT_MODERATE` does not grant edit, publish, or
organizer/moderator management).

### 2. A dedicated `EventStatusHistory` entity, not `AuditLogEntry`

`EventStatusHistory` is its own append-only entity, modeled after
`AuditLogEntry`'s shape (hand-rolled `id`/`createdAt`, no `updatedAt`) but
scoped to `event` rather than `community`, with its own
`fromStatus`/`toStatus` pair rather than a generic `action` enum. Reusing
`AuditLogEntry` was rejected because it would require continuously
extending the Groups module's own `AuditAction`/`AuditTargetType` enums for
Events' lifecycle semantics, coupling Events (explicitly out of scope for
the Organization Domain - see
[organization-domain.md](../architecture/organization-domain.md) and
[ADR-024](ADR-024-organization-domain-independence.md)) to a Groups-module
concern that has nothing to do with the Groups aggregate. This does mean
`GET /events/:id/history` is a second, Events-owned history endpoint,
separate from `GET /groups/:groupId/audit-log` - a deliberate, disclosed
duplication of shape (not of data) in exchange for keeping the two
domains decoupled.

### 3. `ChildrenDirectoryPort`: build the Event-side schema, stub the missing directory

No Children/Family module exists in this codebase, and building one is
explicitly out of scope for the Events module ("Projekt ma współpracować z
istniejącym lub planowanym modułem dzieci" - Events should integrate with
it, not invent it). Two sub-cases were separated:

- **A child with no account (`CHILD_DEPENDENT`)** needs no reusable
  identity at all - the display name is captured as free text scoped to
  one `EventAttendee` row (`dependentDisplayName`). This is fully
  functional today with no external dependency.
- **A child with their own account (`CHILD_ACCOUNT`)** would need a real
  parent -> child relationship to verify the caller is actually that
  child's parent, and to offer a "pick from my children" list. Since that
  relationship does not exist, this path is wired through a small
  interface, `ChildrenDirectoryPort` (`listChildrenOf`,
  `canRegisterChildAccount`), bound today to a `NullChildrenDirectoryService`
  that always returns `[]` / `false` - failing closed rather than trusting
  the caller's unverified word for a parent/child relationship. Every
  `CHILD_ACCOUNT` registration attempt is therefore rejected today with
  `CHILDREN_DIRECTORY_NOT_AVAILABLE`, a known, disclosed limitation (see
  `docs/api/events-api.md` "Open items"). Swapping in a real Children
  module later means providing a new binding for this port - no change to
  any Event entity, service, or endpoint contract.

## Consequences

- Events' administrative-role system and history log are structurally
  independent of the Groups module's equivalents, at the cost of some
  duplicated shape (two role-assignment systems, two history logs) -
  judged worth it to keep "Event roles are separate from Community roles"
  true at the schema level, not just at the API surface.
- `EVENT_MODERATE` is a new, narrow cross-cutting capability that a future
  reviewer should be aware of when reasoning about "who can affect this
  Event" - it is intentionally invisible from `EventRoleAssignment` alone.
- Child-with-own-account registration is inert until a real Children
  module is integrated. This should be revisited as a product decision
  (which team owns the parent/child relationship, what its data model
  looks like) rather than guessed at here.
