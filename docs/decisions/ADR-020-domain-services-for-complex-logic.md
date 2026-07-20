# ADR-020: Domain Services for Complex Logic

## Status

Accepted

## Context

This is a cross-domain principle shared by all CapoHub modules. Several
operations (hierarchy validation, graduation rules, membership lifecycle,
invitation handling) span multiple entities and do not naturally belong to
any single entity's own state.

## Decision

Complex business logic belongs to dedicated Domain Services:

- `GroupHierarchyService`
- `GraduationService`
- `MembershipService`
- `InvitationService`

Entities remain focused on business state; cross-entity logic belongs to
Services.

## Consequences

Entities stay simple and easy to reason about; any logic that reaches
across more than one entity has an obvious, dedicated home. See
[Aggregate overview](../architecture/organization-domain.md#aggregate-overview)
for how these Services relate to the Group, Graduation, and User
Graduation Aggregates.
