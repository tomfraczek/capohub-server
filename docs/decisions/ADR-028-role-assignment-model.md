# ADR-028: Role Assignment Model (Variant B, System Roles)

## Status

Accepted

## Context

Two designs were possible for where a User's Role lives:

- **Variant A** - a Role is a property of Membership itself (a Membership
  row carries a `role` field, alongside status/join date/leave date).
- **Variant B** - a Role is granted through an independent record, a
  **Role Assignment**, entirely separate from Membership.

Variant A is simpler on paper but conflates two different questions into
one record: "does this User belong to this organization" (Membership) and
"what can this User do, and in which specific Group" (Role/Permission -
see [ADR-013](ADR-013-no-permission-inheritance.md)). Since Role/Permission
is assigned per-Group (Root or Child) and never inherits through the
hierarchy, while Membership is assigned per-Root-Group only (see
[ADR-004](ADR-004-no-membership-inheritance.md)), Variant A has no single
consistent home for a Role held in a Child Group - Membership does not
exist there.

A second question had to be settled alongside Variant A/B: are Roles (and
the Permissions each one grants) a fixed system enum, or can organizations
define their own custom Roles and Permission sets? A configurable model
would require a Role/Permission editor, per-organization storage of Role
definitions, and a resolution mechanism for what a custom Role is even
allowed to grant - substantial scope with no current requirement to
justify it.

## Decision

CapoHub adopts **Variant B: Role Assignment**, with a **fixed, system-wide
Role and Permission enum** - not organization-configurable.

### System roles and permissions

- Roles are a fixed enum defined by CapoHub, not by organizations or
  users. Examples: `Owner`, `Admin`, `Instructor`, `Member`.
- Permissions are likewise a fixed enum defined by CapoHub.
- Organizations and users cannot create custom Roles, cannot define custom
  Permission sets, and cannot edit what a Role grants. There is no Role or
  Permission editor.
- Extending the set of system Roles or Permissions requires a code change
  and a migration, released by CapoHub - never a configuration action
  available to an organization or user.
- Every Role carries a fixed, ordered set of Permissions; a higher Role's
  Permission set is a superset of every lower Role's within the same
  Group (see "One Role per (Membership, Group)" below).

### Role Assignment

- Membership represents exclusively a User's participation in a Root
  Group. Membership never stores a Role.
- A Role is granted through a **Role Assignment**, a record independent of
  Membership. Every Role Assignment references exactly one Membership,
  exactly one Group (Root or Child), and exactly one system Role.
- Every Role Assignment requires its Membership to be active in the same
  Root Group as the target Group. A Role can never be assigned to a User
  who has no active Membership in that organization.
- **One Role per (Membership, Group)** - a Membership may have at most one
  **active** Role Assignment for any single Group. Because a higher Role
  always carries a broader Permission set than a lower one within the same
  Group (see above), there is never a need for a Membership to hold more
  than one simultaneous Role there; changing a member's Role in a Group
  replaces the existing Role Assignment rather than adding another one
  alongside it.
- The same Membership may hold Role Assignments in **multiple different**
  Groups at once, each independently. Example: Jan's Membership belongs to
  Root Group `Capoeira Brasil`; Jan simultaneously holds a `Member` Role
  Assignment for `Capoeira Brasil` itself, an `Admin` Role Assignment for
  Child Group `Poznań`, and an `Instructor` Role Assignment for Child Group
  `Leszno`. One Role per Group, different Roles across Groups.
- Roles are never inherited through the Group hierarchy (unchanged from
  [ADR-013](ADR-013-no-permission-inheritance.md)): a Role Assignment in a
  parent Group grants no authority in a Child Group, and vice versa.
- A Role Assignment expires **logically** the moment the Membership it
  depends on is no longer `ACTIVE` - it stops granting any authority
  immediately, without requiring an explicit revocation step. It is not
  necessarily deleted at that moment; whether it currently grants
  authority is resolved dynamically by checking Membership status, the
  same way Section assignments remain as history without granting active
  access once their Membership ends (see
  [Section](../architecture/organization-entities.md#section)).
- Membership and Role Assignment remain independently revocable: ending a
  Membership logically expires every Role Assignment tied to it, but an
  administrator may also revoke or replace a single Role Assignment on its
  own (e.g. demoting an Admin to a plain Member) without affecting
  Membership at all.
- A guard authorizing an action on a Group resolves the Permission set
  from the single Role Assignment held directly for that Group by the
  caller's Membership - never from a Role held in a different Group, and
  never by combining multiple Roles.

See [RoleAssignment](../architecture/organization-entities.md#roleassignment)
for the full entity reference.

## Consequences

- Membership becomes a pure participation record: User, Root Group,
  status, join/leave dates - nothing about authority.
- A User can simultaneously hold different Roles in different Groups
  within the same organization (e.g. `Admin` of one Child Group and
  `Instructor` of another), but never more than one Role in any single
  Group.
- Authorization checks resolve a caller's Role for a specific Group by
  querying the single Role Assignment for that (Membership, Group) pair,
  never by reading a `role` field off Membership and never by combining
  several Roles.
- Revoking a Role no longer requires touching Membership, and ending a
  Membership no longer requires deciding what to do with a `role` field -
  every Role Assignment tied to it simply stops granting authority.
- Because Roles and Permissions are a fixed system enum, there is no
  Custom Roles feature, no Role/Permission editor, and no per-organization
  Permission configuration to build, test, or secure. Any future addition
  to the Role or Permission enum is a CapoHub code change plus migration,
  not a runtime configuration option.

See [ADR-004](ADR-004-no-membership-inheritance.md) and
[ADR-013](ADR-013-no-permission-inheritance.md) for the related decisions
this ADR builds on.
