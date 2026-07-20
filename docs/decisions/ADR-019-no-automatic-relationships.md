# ADR-019: No Automatic Relationships

## Status

Accepted

## Context

This is a cross-domain principle shared by all CapoHub modules. The
system repeatedly encounters situations where two records look related
(e.g. a plain-text name matching a newly created User) but no explicit
action has confirmed that relationship.

## Decision

CapoHub never creates relationships automatically. Relationships are
never inferred automatically; explicit user action is always required.

Example - wrong: a User named "Mestre João" is created and automatically
linked to existing text references reading "Mestre João". Correct: an
administrator explicitly links the User to the reference. The application
never guesses.

## Consequences

This is the general principle behind
[ADR-010](ADR-010-no-automatic-person-linking.md)'s specific application
to instructor references; any future module facing a similar "these two
things look related" situation must require explicit confirmation rather
than inferring the link.
