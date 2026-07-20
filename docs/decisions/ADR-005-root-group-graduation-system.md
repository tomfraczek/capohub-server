# ADR-005: Root Group Graduation System

## Status

Accepted

## Context

Graduation Systems belong exclusively to Root Groups. Only Root Groups own
Graduation Systems; child Groups always use the Root Group's system.
Every Root Group must have a Graduation System - the relationship is
mandatory (1:1), not optional.

Example:

```text
Capoeira Brasil
│
├── Poland
├── Germany
└── France
```

Only `Capoeira Brasil` defines the graduation system. Every descendant Group
automatically uses it.

### Why

A graduation system defines the identity of an organization. Allowing child
Groups to modify it would create inconsistencies - `Capoeira Brasil Poland`
should never introduce its own yellow cord, instructor titles, or category
order. The graduation system belongs to the organization, not to local
Groups.

## Decision

A Root Group always has exactly one Graduation System; the relationship
is mandatory (1:1), created together with the Root Group itself. A Child
Group cannot create one, cannot edit one, and cannot replace one. It
always inherits the Root Group's system.

## Consequences

- A Root Group is not considered fully created/valid until its Graduation
  System exists; the two are created atomically.
- No Root Group can exist in a state with zero Graduation Systems.

See [GraduationSystem](../architecture/organization-entities.md#graduationsystem)
and [ADR-009](ADR-009-graduation-history-source-of-truth.md).
