# ADR-009: Graduation History Is the Source of Truth

## Status

Accepted

## Context

A User has at most one current graduation per Root Group (0..1 - the
record only exists once a first Graduation has been granted there, see
[ADR-011](ADR-011-graduation-order-validation.md#initial-assignment)).
Without a fast-access current-graduation record, every profile view
would need to search the entire graduation history, which becomes
increasingly expensive over time.
At the same time, the full promotion history (every Yellow → Blue → Green
transition, with dates) must remain available and must never be lost.

## Decision

**Graduation History is the source of truth.** History is immutable -
every promotion creates a new historical entry (`UserGraduationEntry`), and
old entries are never modified. Graduation history is preserved
permanently, including entries created in bulk via Batch Promotion, which
creates individual historical records rather than one aggregate record.

**`UserCurrentGraduation` is only a projection** built purely as a read
model over that history. It stores no historical information itself
(only: current Graduation Level, current Graduation Category, Root Group,
assigned date, last updated) and simply references the newest valid
history entry. It does not exist until the User's first Graduation Level
is granted in that Root Group (via Initial Assignment); until then, the
User has no Current Graduation there.

## Consequences

- Reads of "what is this user's current graduation" stay cheap via the
  projection, while the append-only history remains authoritative for
  audits, corrections, and historical reporting.
- Any process that rebuilds or corrects `UserCurrentGraduation` must derive
  it from `UserGraduationEntry` history, never the reverse.
- See [UserGraduationEntry](../architecture/organization-entities.md#usergraduationentry)
  and [UserCurrentGraduation](../architecture/organization-entities.md#usercurrentgraduation).
