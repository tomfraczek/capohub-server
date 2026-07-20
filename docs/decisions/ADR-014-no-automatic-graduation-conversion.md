# ADR-014: No Automatic Graduation Conversion

## Status

Accepted

## Context

Changing organizations is one of the most complex operations in the
system. Different organizations' graduation systems are frequently
incompatible - e.g. Organization A uses `Yellow, Blue, Green` while
Organization B uses `White, Yellow, Orange, Blue`. There is no reliable
mapping between such systems, so automatically converting a member's
graduation when they change organizations would produce incorrect results.

## Decision

CapoHub intentionally avoids automatic graduation conversion. Graduation
systems are never converted automatically; organization changes always
require explicit administrative decisions.

When a member joins another organization, the previous graduation becomes
[Legacy Graduation](ADR-015-legacy-graduation.md) rather than being mapped
onto the new organization's system. Both graduations exist independently;
no synchronization occurs between them.

## Consequences

Members retain an accurate historical record under their original
organization instead of a fabricated equivalence, at the cost of requiring
a fresh first promotion (see
[ADR-015](ADR-015-legacy-graduation.md)) within the new organization. See
[Graduation History](../architecture/organization-entities.md#usergraduationentry).
