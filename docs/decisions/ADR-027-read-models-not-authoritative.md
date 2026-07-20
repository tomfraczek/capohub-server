# ADR-027: Read Models Are Not Authoritative

## Status

Accepted

## Context

Some frequently accessed data is expensive to compute from its source on
every read - Current Graduation (`UserCurrentGraduation`), current Member
Count, current Section Count, and current Academy Count are all optimized
as read models / cached projections. Business correctness has higher
priority than optimization: optimization should only happen after
correctness, and when it does, business rules must remain unchanged.

## Decision

Read models exist only for performance. They never become business truth.
When optimization is necessary, projections, caches, and read models may
be introduced, but they never become the source of truth.

## Consequences

Any read model can be safely dropped and rebuilt from its source data
without loss of business information. This is the general form of
[ADR-009](ADR-009-graduation-history-source-of-truth.md)'s
`UserCurrentGraduation`-specific rule and
[ADR-018](ADR-018-single-source-of-truth.md)'s single-source-of-truth
principle. See
[Aggregate overview](../architecture/organization-domain.md#aggregate-overview)
for the Domain Events (`GraduationAssigned`, `GraduationCorrected`,
`GroupMoved`) that future modules may subscribe to when building their own
read models.
