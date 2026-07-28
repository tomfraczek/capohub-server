# ADR-003: Optional Sections

## Status

Accepted

> **Terminology note (2026-07-28):** the entity this ADR calls "Section" was
> renamed to **Cohort** by the Group/Section domain rename (see ADR-031),
> which reused the name "Section" for a different, previously-unnamed
> concept (a nested Group, formerly called a "Child Group"). Everything
> below describes the Cohort entity under its old name.

## Context

Sections are an organizational convenience (e.g. Kids, Adults, Monday,
Performance Team). Not every Group needs them - a small independent school
should not be forced to model sections it doesn't have.

## Decision

Sections are optional. They are never required. Small groups work exactly
the same as large organizations.

Every feature must work correctly regardless of whether a Group contains
Sections. If a Group contains zero Sections:

- trainings belong directly to the Group,
- announcements belong directly to the Group,
- members belong directly to the Group.

Nothing changes in application behavior.

## Consequences

This allows even very small schools to use the platform without unnecessary
complexity. See
[Section](../architecture/organization-entities.md#section) and
["Groups Without Sections"](../architecture/organization-entities.md#groups-without-sections).
