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

## Consequences

This avoids accidental privilege escalation as organizations grow deeper
hierarchies. See
[Permissions](../architecture/organization-domain.md#permissions) and
[ADR-004](ADR-004-no-membership-inheritance.md) for the equivalent
decision regarding Membership.
