# ADR-010: No Automatic Person Linking

## Status

Accepted

## Context

A promotion's "Awarded By" field may reference a CapoHub User, or - if the
instructor does not use CapoHub - store only plain text (e.g. "Mestre
João"). Later, a User with a matching name might join CapoHub. Many
organizations contain multiple people with identical names, nicknames, or
Capoeira names, so automatically matching the text reference to that User
would inevitably create incorrect references.

## Decision

CapoHub never automatically links text references with User accounts.
Nothing changes automatically when a matching User joins - the author must
explicitly connect the User.

Every instructor reference therefore consists of a `displayName` plus an
optional linked User:

- `displayName` always remains the source of truth.
- The User link is optional metadata.
- If the linked User account disappears, the displayed text remains
  unchanged.

## Consequences

Manual linking guarantees correctness and preserves historical accuracy
even if linked User accounts are later removed. See
[UserGraduationEntry](../architecture/organization-entities.md#usergraduationentry)
for the `awardedByUser` / `awardedByName` fields this decision governs.
