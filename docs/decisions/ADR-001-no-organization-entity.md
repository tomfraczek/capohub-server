# ADR-001: No Organization Entity

## Status

Accepted

> **Terminology note (2026-07-28):** the informal term "Organization" used
> throughout this ADR was formalized as **Group** by the Group/Section
> domain rename (see ADR-031) - a root Group (`parentGroup === null`) is
> what this document calls "the Organization". The core decision below -
> one entity for every hierarchy level, no dedicated Organization
> entity/table - is unchanged and still accurate.

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
