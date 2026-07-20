# ADR-017: Single Owner Per Object

## Status

Accepted

## Context

This is a cross-domain principle shared by all CapoHub modules, not
specific to Organization. Every future domain (Events, Music, Knowledge
Base, Payments, etc.) must follow it.

## Decision

Every business object must have exactly one owner. Ownership determines
who manages the object, where permissions are evaluated, where the object
appears, and which hierarchy rules apply. Objects never belong to multiple
Groups.

| Entity | Owner |
|----------|-------|
| Academy | Group |
| Section | Group |
| Membership | Group |
| Invitation | Group |
| Training | Group |
| Announcement | Group |
| Event | Group |
| Poll | Group |
| Graduation System | Root Group |
| Graduation Category | Graduation System |
| Graduation Level | Graduation Category |
| Graduation History | User |

## Consequences

Every object's management and permission evaluation has one unambiguous
owner, eliminating multi-Group ownership conflicts. See
[ADR-018](ADR-018-single-source-of-truth.md) for the related principle
governing derived data.
