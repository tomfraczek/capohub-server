# ADR-013: No Permission Inheritance

## Status

Accepted

## Context

Permissions define what a user can do (create/edit/delete trainings,
manage members, fees, events, sections, announcements) and are granted
through a Role, from a fixed system Role/Permission enum (see
[ADR-028](ADR-028-role-assignment-model.md)) - never through a
per-organization or per-user configuration. Groups form a hierarchy (e.g.
Capoeira Brasil → Poland → Poznań); it must be decided whether
administrative permissions granted at one level automatically apply to
descendant Groups.

## Decision

Groups are independent. Hierarchy never grants permissions automatically,
and permissions never inherit through the Group hierarchy.

Example: an administrator of `Poland` does **not** automatically become
administrator of `Poznań`. Every Group manages its own permissions
independently.

A caller's Permissions for a Group are resolved from the **union** of
every Role Assignment they hold directly for that Group - a Membership
may hold several Roles for the same Group at once (see
[ADR-028](ADR-028-role-assignment-model.md)) - there is no separate direct
Permission assignment that bypasses a Role.

Hierarchy traversal is used only for resource visibility resolution (see
[ADR-008](ADR-008-visibility-scope.md)); it never creates Memberships,
never grants Permissions, and never creates Roles.

### Membership is a separate concept from Role Assignment

Membership (see [ADR-004](ADR-004-no-membership-inheritance.md)) and
Role Assignment (see
[ADR-028](ADR-028-role-assignment-model.md)) answer two different
questions, and must not be conflated - Membership never stores a Role:

- **Membership** - does this User belong to this organization at all?
  Membership always references the Root Group; it is never created for a
  Child Group. It carries no authority by itself, and creates no Role
  Assignment by itself - not even `Member` for the Root Group, which is a
  Group like any other (see
  [ADR-004](ADR-004-no-membership-inheritance.md)).
- **Role Assignment** - what can this User do, and where? A Role
  Assignment is granted directly for one specific Group - Root or Child -
  and grants authority only there. Holding a Role in the Root Group grants
  no authority over any Child Group, and holding a Role in a Child Group
  grants no authority over the Root Group, any sibling Child Group, or any
  other Group. A Membership may hold **several different** Role
  Assignments for the very same Group at once (e.g. `Member` +
  `Instructor` + `Admin` together) - only holding the exact same Role
  twice for the same Group is disallowed. `Member` is the base Role every
  other Role requires - the system guarantees this automatically on grant
  and protects it on revoke (see
  [ADR-028](ADR-028-role-assignment-model.md)). The same Membership may
  also hold Role Assignments for multiple *different* Groups within its
  Root Group's tree at once, independently of each other. In practice, a
  Root Group administrator's authority covers the Root Group itself and
  the organization-wide Graduation System (see
  [ADR-005](ADR-005-root-group-graduation-system.md)) - not the rest of
  the tree. A Child Group is managed by whoever holds a Role directly in
  that Child Group.
- Every Role Assignment requires an active Membership in the same Root
  Group, and expires logically the moment that Membership is no longer
  `ACTIVE` - see [ADR-028](ADR-028-role-assignment-model.md) for the full
  model.
- Academy and Section have no Role Assignment or Membership of their own
  (see [ADR-012](ADR-012-academy-not-organizational-unit.md) and
  [Section](../architecture/organization-entities.md#section)) - an
  operation on an Academy or a Section is authorized against the Role
  Assignment the caller holds in the Group that owns it.

## Consequences

This avoids accidental privilege escalation as organizations grow deeper
hierarchies. See
[Permissions](../architecture/organization-domain.md#permissions) and
[ADR-004](ADR-004-no-membership-inheritance.md) for the equivalent
decision regarding Membership, and
[ADR-028](ADR-028-role-assignment-model.md) for the Role Assignment
entity that carries this decision out.
