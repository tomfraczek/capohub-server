# ADR-021: Transactional Operations

## Status

Accepted

## Context

This is a cross-domain principle shared by all CapoHub modules. Some
operations affect many records at once - Batch Promotion touches every
selected member's Graduation History, and moving a Group re-parents an
entire subtree. Partial execution of either would leave the system in an
inconsistent state.

## Decision

Business operations affecting multiple entities execute transactionally.
Complex, multi-entity business operations should be transactional: Batch
Promotion either promotes all selected members or none; moving a Group
either updates the entire affected hierarchy or changes nothing. Partial
execution is unacceptable.

## Consequences

Any Domain Service implementing a multi-entity operation must wrap it in
a transaction boundary so failures cannot leave some entities updated and
others not - including a single member's graduation-order validation
failure inside a Batch Promotion, which must roll back the entire batch.
See [ADR-016](ADR-016-batch-promotion.md) and
[ADR-002](ADR-002-unlimited-group-hierarchy.md) for the two operations
called out as examples.
