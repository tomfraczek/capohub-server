# ADR-001: No Organization Entity

## Status

Accepted

## Context

CapoHub must support independent schools, local groups, national organizations,
international organizations, organizations with dozens of hierarchy levels,
organizations without hierarchy, and organizations with or without sections.
The system must never force a particular organizational model.

## Decision

There is no dedicated Organization entity.

Every organizational unit is represented by the same entity: international
organization, national organization, regional organization, city, local
school. All of them are Groups. Their role depends only on their position
inside the hierarchy. The organizational hierarchy is built entirely
using parent-child Group relationships.

## Consequences

The application does not distinguish between different "types" of
organizations. It relies entirely on hierarchy. No special entity exists for
an international federation versus a single local school - see
[Group](../architecture/organization-entities.md#group).
