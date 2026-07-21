# ADR-004: No Membership Inheritance

## Status

Accepted

## Context

Groups form a hierarchy (e.g. `Capoeira Brasil` → `Poland` → `Poznań`).
Membership represents "does this User belong to this organization" - it
must be decided what "this organization" refers to when Groups are
arranged in a tree, and whether belonging to one Group in that tree
implies belonging to another.

Example:

```text
Capoeira Brasil (Root Group)
└── Poland
    └── Poznań
```

If a User holds a Role in `Poznań`, should the User automatically become a
Membership-holder of `Poland` and `Capoeira Brasil` too? And separately:
does belonging to the organization automatically make the User a member
(in the everyday sense) of the Root Group itself, the way it might make
them a member of any other Group?

## Decision

**Membership answers exactly one question: does this User belong to this
organization at all?** It always references the Root Group of that
organization's tree - never a Child Group - and is never created,
duplicated, or inherited for any other Group in the tree. There is exactly
one Membership per (User, Root Group) pair active at a time (see
[Membership](../architecture/organization-entities.md#membership)).

**Membership is not the same thing as belonging to the Root Group as a
Group.** The Root Group is a Group like any other in the tree - it has its
own daily life (trainings, events, announcements, members, instructors,
administrators), exactly like `Poznań` or any other Child Group. Whether a
User is a day-to-day participant of that specific Group - the Root Group
included - is answered by **MEMBER**, a Role Assignment for that specific
Group (see [ADR-028](ADR-028-role-assignment-model.md)), never by
Membership. Creating a Membership does **not** create a MEMBER Role
Assignment for the Root Group, or for any Group - not even automatically.
A User can hold an `ACTIVE` Membership with zero Role Assignments at all:
this means the User belongs to the organization but has not yet been
assigned to any Group within it, which is a normal, expected, and fully
supported state.

The only case Membership is inherited into is the User's own Root Group -
by definition, not by propagation - and even then it grants no Role there.
No Membership is ever created for a Child Group, and no Membership implied
by one Group ever creates or implies a Membership, or a Role, for a
different Group.

### Why

Automatic Membership inheritance, and treating Membership as if it were
also "membership of the Root Group as a Group," introduce unnecessary
complexity, including:

- permission inheritance,
- duplicate memberships,
- membership lifecycle synchronization,
- role conflicts,
- an artificial special case for the Root Group that every other Group in
  the tree does not have,
- historical consistency problems.

Keeping Membership scoped to "belongs to the organization" only, with zero
implication about any specific Group (Root included), makes the entire
model simpler, more predictable, and uniform: every Group - Root or Child
- is populated with MEMBER Role Assignments the exact same way, on
purpose, never automatically as a side effect of something else.

### Implications

Features that operate on hierarchy are responsible for traversing the
hierarchy explicitly.

Example: a parent Group sending an announcement to all descendant Groups
should:

1. Traverse the hierarchy.
2. Collect descendant Groups.
3. Collect active Role Assignments from those Groups.
4. Deliver the announcement.

No hidden Membership inheritance, and no hidden Root-Group-MEMBER
inheritance, is used.

## Consequences

Benefits:

- simpler permission model,
- simpler Membership lifecycle,
- easier auditing,
- no duplicate Memberships,
- no synchronization problems,
- predictable behavior,
- the Root Group needs no special case: exactly like every Child Group, a
  User must be explicitly assigned a Role there to be a MEMBER of it.

A consequence worth naming explicitly: adding a User to an organization
(creating their Membership) and populating a specific Group with members
are two independent operations. An administrator who wants a new
organization member to also participate in the Root Group's own daily
activities must explicitly grant them a Role there (see
`POST /groups/:rootGroupId/role-assignments`, or provide a Role directly
when adding the member) - it does not happen on its own.

See [Membership](../architecture/organization-entities.md#membership) and
[ADR-013](ADR-013-no-permission-inheritance.md) for the equivalent decision
regarding permissions, and [ADR-028](ADR-028-role-assignment-model.md) for
the Role Assignment model that keeps Roles out of Membership entirely.
