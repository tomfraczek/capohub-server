# ADR-025: Business Entities Only

## Status

Accepted

## Context

The Organization Domain is responsible only for organizational hierarchy,
members, permissions, graduation, academies, and sections - everything
else belongs elsewhere. Without an explicit boundary, presentation and
UI-specific concerns could creep into the domain model.

## Decision

Only business entities belong inside this Domain. Presentation concerns
are excluded.

## Consequences

UI-specific details (e.g. how "approximate" historical dates are
displayed, per [ADR-011](ADR-011-graduation-order-validation.md)) are
explicitly left to the application layer rather than modeled in the
domain. See [ADR-024](ADR-024-organization-domain-independence.md) for the
companion principle governing the Domain's dependencies.
