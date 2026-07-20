# ADR-004: No Membership Inheritance

## Status

Accepted

## Context

Membership exists only within the Group it was created for. A Membership
represents a direct relationship between a User and a single Group.

Example:

```text
Capoeira Brasil
└── Poland
    └── Poznań
```

If a User belongs to `Poznań`, should the User automatically become a member
of `Poland` and `Capoeira Brasil`?

## Decision

Membership is never inherited through the Group hierarchy. No additional
Memberships are created for ancestor Groups.

Hierarchy represents organizational structure only. Membership represents
participation. These concepts are intentionally separated.

### Why

Automatic Membership inheritance introduces unnecessary complexity, including:

- permission inheritance,
- duplicate memberships,
- membership lifecycle synchronization,
- role conflicts,
- historical consistency.

Keeping Membership local to a single Group makes the entire model simpler
and more predictable.

### Implications

Features that operate on hierarchy are responsible for traversing the
hierarchy explicitly.

Example: a parent Group sending an announcement to all descendant Groups
should:

1. Traverse the hierarchy.
2. Collect descendant Groups.
3. Collect active Memberships from those Groups.
4. Deliver the announcement.

No hidden Membership inheritance is used.

## Consequences

Benefits:

- simpler permission model,
- simpler Membership lifecycle,
- easier auditing,
- no duplicate Memberships,
- no synchronization problems,
- predictable behavior.

See [Membership](../architecture/organization-entities.md#membership) and
[ADR-013](ADR-013-no-permission-inheritance.md) for the equivalent decision
regarding permissions.
