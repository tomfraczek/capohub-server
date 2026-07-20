# ADR-018: Single Source of Truth

## Status

Accepted

## Context

This is a cross-domain principle shared by all CapoHub modules. Several
values are cheaper to read as caches or projections than to recompute
every time (e.g. Current Graduation, Member Count, Children Count), but
those conveniences must not be allowed to drift from the data that
actually defines them.

## Decision

Every piece of information has exactly one source of truth. Derived
values must never become independent sources.

Examples:

- Current Graduation is derived from Graduation History.
- Member Count is derived from Memberships.
- Children Count is derived from Group hierarchy.

The application may cache those values for performance, but the cache
must never become the authoritative data source.

## Consequences

Any discrepancy between a cached/derived value and its source is a bug in
the cache, never a reason to treat the cache as authoritative; recovery
always means recomputing from the source. See
[ADR-009](ADR-009-graduation-history-source-of-truth.md) for the
graduation-specific instance of this principle, and
[ADR-027](ADR-027-read-models-not-authoritative.md) for its application to
Read Models generally.
