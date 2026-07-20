# ADR-022: Immutable Identifiers

## Status

Accepted

## Context

This is a cross-domain principle shared by all CapoHub modules.
Human-readable values change often (a Group renaming from "Capoeira
Brasil Poznań" to "Capoeira Brasil Poznań Centrum"), and archived objects
must remain valid references (historical graduations still reference an
archived Group). References throughout the system must not break when
display text changes or an object is archived.

## Decision

Every entity owns an immutable identifier. Identifiers never change.
Human-readable values (display names) may change freely; the identifier
remains identical, guaranteeing stable references.

Archived objects remain valid references - nothing that already points to
an archived object breaks.

## Consequences

Renaming an entity requires no reference updates anywhere in the system;
only the displayed name changes. See
[ADR-023](ADR-023-stable-public-codes.md) for the related but distinct
concept of user-facing Public Codes.
