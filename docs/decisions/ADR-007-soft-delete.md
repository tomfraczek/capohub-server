# ADR-007: Soft Delete

## Status

Accepted

## Context

Deleting a Group physically would destroy references from memberships,
graduations, announcements, media, trainings, attendance, and history.
Historical integrity must never be compromised, so removal must not be a
physical deletion.

## Decision

Groups are never physically deleted. Instead they become archived.

Archived Groups:

- cannot receive new members,
- cannot create new trainings,
- cannot create new announcements,
- remain visible in historical data.

Applications may hide archived Groups by default.

The same soft-delete policy applies to the following entities:

- Group
- Academy
- Section
- Membership
- Invitation

Historical entities are never permanently removed.

## Consequences

Historical integrity has higher priority than data cleanup. See
[Group](../architecture/organization-entities.md#group) for the archived
state's effect on Group behavior.
