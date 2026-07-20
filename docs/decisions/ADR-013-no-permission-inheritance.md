# ADR-013: No Permission Inheritance

## Status

Accepted

## Context

Permissions define what a user can do (create/edit/delete trainings,
manage members, fees, events, sections, announcements) and are granted
through Roles or direct assignment. Groups form a hierarchy (e.g. Capoeira
Brasil → Poland → Poznań); it must be decided whether administrative
permissions granted at one level automatically apply to descendant Groups.

## Decision

Groups are independent. Hierarchy never grants permissions automatically,
and permissions never inherit through the Group hierarchy.

Example: an administrator of `Poland` does **not** automatically become
administrator of `Poznań`. Every Group manages its own permissions
independently.

Direct permissions always override inherited Role permissions within a
single Group.

Hierarchy traversal is used only for resource visibility resolution (see
[ADR-008](ADR-008-visibility-scope.md)); it never creates Memberships,
never grants Permissions, and never creates Roles.

### Membership is a separate concept from Role/Permission

Membership (see [ADR-004](ADR-004-no-membership-inheritance.md)) and
Role/Permission answer two different questions, and must not be
conflated:

- **Membership** - does this User belong to this organization at all?
  Membership always references the Root Group; it is never created for a
  Child Group. It carries no authority by itself.
- **Role/Permission** - what can this User do, and where? A Role/Permission
  is assigned directly to one specific Group - Root or Child - and grants
  authority only there. Holding a Role in the Root Group grants no
  authority over any Child Group, and holding a Role in a Child Group
  grants no authority over the Root Group or any other Group. In
  practice, a Root Group administrator's authority covers the Root Group
  itself and the organization-wide Graduation System (see
  [ADR-005](ADR-005-root-group-graduation-system.md)) - not the rest of
  the tree. A Child Group is managed by whoever holds a Role directly in
  that Child Group.
- Academy and Section have no Role/Permission or Membership of their own
  (see [ADR-012](ADR-012-academy-not-organizational-unit.md) and
  [Section](../architecture/organization-entities.md#section)) - an
  operation on an Academy or a Section is authorized against the
  Role/Permission the caller holds in the Group that owns it.

## Consequences

This avoids accidental privilege escalation as organizations grow deeper
hierarchies. See
[Permissions](../architecture/organization-domain.md#permissions) and
[ADR-004](ADR-004-no-membership-inheritance.md) for the equivalent
decision regarding Membership.
