# ADR-029: Community Deletion (Terminal, Still Non-Physical)

## Status

Accepted

## Context

The Community administrative module needs a "permanently delete this
Community" action, distinct from the existing Archive/Unarchive pair.
Archive already exists (see the codebase's own `GroupStatus` history) and
is fully reversible: an archived Group can always be restored to `ACTIVE`
via Unarchive. Product requirements for Delete are explicitly that it be a
*separate*, more final action than Archive - Archive still means "temporary
deactivation," and admins need a genuinely terminal action on top of it.

[ADR-007](ADR-007-soft-delete.md) already settled the general question of
physical deletion for this domain: "Groups are never physically deleted...
Deleting a Group physically would destroy references from memberships,
graduations, announcements, media, trainings, attendance, and history."
That decision applies just as much to a Community-level Delete action as it
does to Archive - a literal `DELETE FROM groups` (or cascading row removal)
would break every Membership, Role Assignment, Membership Request, and
Audit Log entry that references the Group, several of which (Membership,
Audit Log) exist specifically to preserve history indefinitely. Nothing
about "the admin wants this gone for good" changes that referential-
integrity requirement.

This leaves a real design gap to fill: how can Delete be genuinely
*irreversible* (unlike Archive) while remaining *non-physical* (per
ADR-007)?

## Decision

`GroupStatus` gains a fourth value, `DELETED`, alongside `ACTIVE`,
`READ_ONLY`, and `ARCHIVED`.

- `DELETED` is a **terminal sink state**: unlike `ARCHIVED` (which can
  transition back to `ACTIVE` via Unarchive), there is no operation that
  moves a Group *out of* `DELETED`. This is what makes Delete meaningfully
  different from Archive from a product perspective, while both remain
  equally non-physical from a data perspective.
- Deleting is a **status-only change**, exactly like every other lifecycle
  transition (Archive, Unarchive, Set Read-Only, Activate). It does **not**
  cascade to Memberships or Role Assignments, which remain as historical
  rows - identical to Archive's existing behavior. The row, and every
  reference to it, survives permanently.
- Deleting is **blocked while the Group has any Child Group that is not
  already `ARCHIVED` or `DELETED`** - a Community must not be permanently
  removed while it still has an active, functioning substructure hanging
  off of it with no way back. This is the one respect in which Delete is
  stricter than Archive (Archive has no such check).
- `GROUP_DELETE` is its own `GroupPermission`, at the same trust tier as
  `GROUP_ARCHIVE` (`OWNER`-only) - deliberately not reused from
  `GROUP_ARCHIVE`, since Delete is a strictly more severe, non-undoable
  action than Archive.
- Read endpoints (`GET /groups/:id`, member/child/invitation/join-request
  listings, the Audit Log) continue to work against a `DELETED` Group,
  mirroring how they already work against an `ARCHIVED` one - "historical
  integrity" (ADR-007) means the data stays visible, not that it
  disappears from view. `DELETED` Groups are excluded from
  `GET /community/home`'s `myCommunities` and from Discovery search
  results, the same as `ARCHIVED` ones already are.

## Consequences

- Every write endpoint that defaults to `ACTIVE`-only (the
  `GroupPermissionsGuard` default - see `group-write-policy.ts`) already
  rejects a `DELETED` Group automatically, with no extra code: `DELETED` is
  simply never included in any endpoint's `@AllowGroupStatuses(...)`
  allow-list, so every write - including all four other lifecycle
  transitions - is blocked by the existing status-conflict mechanism
  (`409 GROUP_DELETED`).
- A frontend cannot offer any path back from `DELETED` - this is
  deliberate. If a future business requirement calls for undoing a
  Delete, that would need a new, explicit decision (and likely a new
  status or a dedicated restore-from-deleted action), not a silent
  reinterpretation of this one.
- This ADR does not revisit or weaken ADR-007: physical row deletion for
  Group (or any of the entities ADR-007 already covers) remains out of
  scope for this system.
