# ADR-015: Legacy Graduation

## Status

Accepted

## Context

Per [ADR-014](ADR-014-no-automatic-graduation-conversion.md), graduations
are never automatically converted when a member changes organization. A
mechanism is still needed to preserve the member's prior achievement while
allowing the new organization to grade them under its own system.

## Decision

When a member joins another organization, the previous graduation becomes
**Legacy Graduation**. Example: a Blue Cord earned in `Capoeira Brasil`
remains visible as Legacy Graduation after the member joins `Muzenza`. It
is preserved permanently.

Legacy graduations:

- remain visible,
- remain searchable,
- remain historical,
- never disappear.

Legacy graduations cannot become current inside another organization.

### Initial Assignment in a New Organization

The instructor of the new organization independently decides the
member's first Graduation there via an **Initial Assignment** (e.g.
starting at `Yellow` regardless of the Legacy `Blue`) - see
[ADR-011](ADR-011-graduation-order-validation.md#initial-assignment) for
why this is not a promotion and is not subject to graduation-order
validation. This Initial Assignment creates the member's first
`UserGraduationEntry` and, with it, their `UserCurrentGraduation` record
for the new organization - before this, the member has no Current
Graduation there. The Legacy Graduation remains untouched in history.

## Consequences

Members keep an honest, unmodified record of achievements from every
organization they have belonged to, while each organization retains full
authority over grading its own current members. See
[UserGraduationEntry](../architecture/organization-entities.md#usergraduationentry).
