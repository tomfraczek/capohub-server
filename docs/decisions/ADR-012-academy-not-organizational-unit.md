# ADR-012: Academy Is Not an Organizational Unit

## Status

Accepted

## Context

Academy represents a physical location where trainings take place (e.g. a
city-center gym). A Group may operate multiple physical locations
("Capoeira Brasil Poznań" running Academies at City Center, Grunwald, and
Rataje).

## Decision

Academies represent physical locations only. Academies are never
organizational units.

An Academy cannot have members, permissions, administrators, or child
Academies - it is simply a place. It stores name, address, coordinates,
contact information, opening hours, photos, and description.

An Academy always belongs to exactly one Group. It cannot belong to
multiple Groups and cannot exist independently.

## Consequences

Membership, permissions, and hierarchy are modeled exclusively through
Group; Academy stays a simple, dependent location record with no
organizational responsibilities. See
[Academy](../architecture/organization-entities.md#academy).
