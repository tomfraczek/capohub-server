# ADR-016: Batch Promotion

## Status

Accepted

## Context

Organizations frequently promote many members simultaneously (e.g. during
a Batizado). Without a dedicated mechanism, instructors would have to
repeat identical promotion operations hundreds of times, creating
significant administrative work.

## Decision

CapoHub supports **Batch Promotion**. An instructor selects a target
Graduation (e.g. `Blue / Green`) and a set of members (e.g. John, Anna,
Chris, Robert, Maria).

Batch Promotion does **not** bypass graduation-order validation. Each
selected member is validated individually against the same
graduation-order rules as a normal promotion (see
[ADR-011](ADR-011-graduation-order-validation.md)). If every member
passes validation, the system creates one independent Graduation History
entry per member. If even one member fails validation, the entire
operation is rolled back and no member is promoted - consistent with the
transactional, all-or-nothing requirement in
[ADR-021](ADR-021-transactional-operations.md).

Every Batch Promotion stores:

- author,
- creation date,
- Root Group,
- target Graduation,
- optional note.

Individual `UserGraduationEntry` records reference the Batch they were
created from, which simplifies auditing.

## Consequences

Batch Promotion creates individual historical records, not one aggregate
record - each member's history stays independently correct and traceable
back to the batch operation that produced it. See
[UserGraduationEntry](../architecture/organization-entities.md#usergraduationentry)
and [ADR-009](ADR-009-graduation-history-source-of-truth.md).
