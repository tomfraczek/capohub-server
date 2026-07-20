# ADR-024: Organization Domain Independence

## Status

Accepted

## Context

CapoHub will grow additional modules over time (Events, Payments, Music,
Knowledge, Chat, Notifications). The Organization Domain models the core
concepts (Groups, Membership, Graduation) that nearly every other module
needs to reference.

## Decision

The Organization Domain should not depend on Events, Payments, Music,
Knowledge, Chat, or Notifications. Instead, those modules depend on
Organization. This keeps the Organization Domain stable.

## Consequences

The Organization Domain can be developed, tested, and reasoned about in
isolation from every feature module built on top of it, and changes in
those feature modules can never force a change in Organization. See
[ADR-025](ADR-025-business-entities-only.md) for the related principle
governing what belongs inside the Organization Domain itself.
