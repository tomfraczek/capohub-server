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
- **Multiple Roles per (Membership, Group) are allowed.** A Membership may
  hold several *different* Roles for the same Group at the same time (e.g.
  `Member` + `Instructor` + `Admin`, all simultaneously, for the same
  Group). What is not allowed is holding the **same** Role twice for the
  same (Membership, Group) pair - the uniqueness constraint is
  `UNIQUE (membership, group, role)`, not `UNIQUE (membership, group)`.
  Granting a new Role never removes or replaces an existing one; revoking
  a Role only removes that one Role Assignment row and leaves every other
  Role the Membership holds for that Group untouched.
- **MEMBER is not a default inferred from Membership - it is its own Role
  Assignment.** Membership answers "does this User belong to the
  organization"; the `Member` Role Assignment for a specific Group answers
  "does this User belong to *this* Group". Being added to, or joining, a
  Group (Root or Child) automatically grants a `Member` Role Assignment
  for that Group at the same time - not as a side effect inferred later,
  but as a real row created atomically alongside the event that adds the
  User to that Group.
- The same Membership may also hold Role Assignments in **multiple
  different** Groups at once, each independently. Example: Jan's
  Membership belongs to Root Group `Capoeira Brasil`, where he holds a
  `Member` Role Assignment. In Child Group `Poznań`, Jan simultaneously
  holds three Role Assignments: `Member`, `Instructor`, and `Admin` - all
  three coexist for the same Group. In a different Child Group, `Leszno`,
  Jan holds only `Member` and `Instructor`. Roles never inherit between
  these Groups (see below); each Group's set of Roles for Jan is entirely
  its own.
- Roles are never inherited through the Group hierarchy (unchanged from
  [ADR-013](ADR-013-no-permission-inheritance.md)): a Role Assignment in a
  parent Group grants no authority in a Child Group, and vice versa, and a
  Role Assignment in one Child Group grants no authority in a sibling
  Child Group.
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
  administrator may also revoke a single Role Assignment on its own
  (e.g. removing just the `Instructor` Role while `Member` and `Admin`
  remain) without affecting Membership, or any of the Membership's other
  Role Assignments, at all.
- A guard authorizing an action on a Group resolves the **union** of every
  active Role Assignment the caller's Membership holds directly for that
  exact Group - never from a Role held in a different Group, and never
  just the first or "highest" one found. If the union of Permissions
  across all held Roles satisfies what the action requires, it is
  authorized.

### OWNER is the one exception

- Every Group (Root or Child) must have **exactly one active `Owner`** at
  all times. This is enforced at the database level, independent of which
  Membership holds it: at most one active `Owner` Role Assignment may
  exist per Group.
- `Owner` is granted automatically to whoever creates a Group, at Group
  creation time.
- `Owner` cannot be granted through the general grant-a-Role flow, cannot
  be revoked directly, and a Membership cannot voluntarily give it up - a
  Group can never be left ownerless.
- The only way `Owner` moves from one Membership to another is an
  **atomic ownership transfer**: within a single transaction, the previous
  owner's `Owner` Role Assignment is removed and the new owner's `Owner`
  Role Assignment is created - there is never an intermediate state with
  zero or two active Owners for the same Group.
- A transfer changes *only* the `Owner` Role Assignment. Every other Role
  the previous owner holds for that Group (e.g. `Member`, `Admin`) is left
  completely untouched - there is no "new Role" chosen for the previous
  owner, because Owner was never their only Role to begin with.

See [RoleAssignment](../architecture/organization-entities.md#roleassignment)
for the full entity reference.

## Consequences

- Membership becomes a pure participation record: User, Root Group,
  status, join/leave dates - nothing about authority.
- A User can simultaneously hold several different Roles for the very
  same Group (e.g. `Member` + `Instructor` + `Admin` all at once), in
  addition to holding independent Roles in other Groups.
- Authorization checks resolve a caller's authority for a specific Group
  by querying **every** Role Assignment for that (Membership, Group) pair
  and taking the union of their Permissions - never by reading a `role`
  field off Membership and never by picking just one Role Assignment.
- Granting an additional Role never disturbs existing ones; revoking a
  Role only removes that one Role Assignment. Ending a Membership no
  longer requires deciding what to do with a `role` field - every Role
  Assignment tied to it simply stops granting authority, all of them, at
  once.
- `Owner` is the sole exception to "Roles are just Roles": it is mandatory
  (every Group has exactly one, enforced at the database level),
  automatically granted at creation, and can only move via an atomic
  transfer - never granted, revoked, or left absent through the general
  Role management flow.
- Because Roles and Permissions are a fixed system enum, there is no
  Custom Roles feature, no Role/Permission editor, and no per-organization
  Permission configuration to build, test, or secure. Any future addition
  to the Role or Permission enum is a CapoHub code change plus migration,
  not a runtime configuration option.

See [ADR-004](ADR-004-no-membership-inheritance.md) and
[ADR-013](ADR-013-no-permission-inheritance.md) for the related decisions
this ADR builds on.
