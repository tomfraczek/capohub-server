# ADR-026: Aggregates Communicate Through Services

## Status

Accepted

## Context

The Organization Domain is structured into three Aggregates - the Group
Aggregate, the Graduation Aggregate (rooted at `GraduationSystem`), and
the User Graduation Aggregate (rooted at `UserCurrentGraduation`). Each
aggregate is responsible for its own internal consistency, but business
operations often need to touch more than one of them.

## Decision

Aggregates communicate through Services, never through direct entity
manipulation.

The Group Aggregate never edits the Graduation Aggregate. The Graduation
Aggregate never edits Membership. Membership never edits Group hierarchy.
Every aggregate owns its own consistency; cross-aggregate communication
occurs through Domain Services (see
[ADR-020](ADR-020-domain-services-for-complex-logic.md)).

## Consequences

No aggregate can be corrupted by another aggregate reaching directly into
its internals; every cross-aggregate operation has an explicit, auditable
Service entry point. See
[Aggregate overview](../architecture/organization-domain.md#aggregate-overview)
for the full list of Aggregate Roots and their contents.
