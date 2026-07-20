# ADR-011: Graduation Order Validation

## Status

Accepted

## Context

The Graduation System must enforce graduation consistency, including
graduation order, duplicate prevention, future-date validation, and invalid
category transitions, to guarantee long-term consistency across the entire
graduation history. At the same time, real organizations need a way to
correct mistakes, migrate from other software, or import years of
pre-existing history that cannot satisfy normal order validation.

## Decision

Graduation order is enforced by the system for every **promotion** - a
change from an existing Current Graduation to a new one. Organizations
cannot disable graduation validation for promotions.

Example: given the order `Yellow → Yellow/Blue → Blue → Blue/Green`, a
promotion straight from `Yellow` to `Blue/Green` is invalid unless
performed through an Administrative Override.

A member's first Graduation Level within a Root Group's organization is
not a promotion - see Initial Assignment below. Exceptional situations
affecting existing history are handled through two further dedicated
mechanisms instead of weakening validation itself:

### Initial Assignment

A member's first Graduation Level granted within a Root Group's
organization (e.g. immediately after joining, or after a Legacy
Graduation transfer per [ADR-015](ADR-015-legacy-graduation.md)) is an
**Initial Assignment**, not a promotion. It is not subject to
graduation-order validation, since there is no prior entry within that
organization to validate order against.

Initial Assignment is distinct from both Administrative Override and
Historical Import below: it requires no elevated permissions, override
justification, or audit trail beyond the normal authority to grant a
Graduation - it is simply the first entry, not an exception to a rule.

### Administrative Override

A dedicated administrative operation for exceptional situations such as
importing historical data, correcting historical mistakes, migrating from
another software, or restoring damaged records.

- Requires elevated permissions and explicit confirmation.
- Must always be audited; the audit log includes administrator, timestamp,
  previous graduation, new graduation, and reason for override.

### Historical Import

Historical imports are exempt from normal promotion validation, since
organizations migrating to CapoHub after years of operation frequently
cannot recreate their complete graduation history.

Example: only `2012 - Blue Cord` is known; earlier promotions are unknown.
The administrator may import `2012 - Blue Cord` directly, and it becomes
the oldest known historical record. Future promotions must again follow
the normal graduation order.

Historical imports behave exactly like normal promotions once created, and
CapoHub supports approximate precision for historical data whose exact
date is unknown (e.g. "2012, unknown month" or "2012, estimated") - the
domain simply allows incomplete historical precision; exact UI treatment
is out of scope for this document.

### Rationale

Strict validation protects long-term data consistency. Exceptional cases
should be handled through dedicated administrative workflows rather than
by weakening validation rules for the entire system.

## Consequences

Normal promotions always go through full order validation. Three
mechanisms are exempt, each for a distinct reason: Initial Assignment
(nothing to validate against yet), Administrative Override, and
Historical Import (both explicit, audited exceptions for existing
history). See
[GraduationSystem](../architecture/organization-entities.md#graduationsystem),
[UserGraduationEntry](../architecture/organization-entities.md#usergraduationentry),
and [ADR-009](ADR-009-graduation-history-source-of-truth.md).
