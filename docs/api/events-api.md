---
title: Events API
description: Complete API reference for the Events module (src/events), generated from the current backend implementation. Backend is the source of truth.
status: Generated from implementation
last_updated: 2026-07-27
---

# Events API

> **Terminology note (2026-07-28):** the backend underwent the Group/Section
> domain rename (see
> [ADR-031](../decisions/ADR-031-group-section-domain-rename.md)) after this
> document was last generated - "Organization" below means **Group**, and a
> "Group" (Child Group) means **Section**; some routes may have moved
> accordingly. Treat the source code as authoritative until this document is
> regenerated.

## What is an Event?

An Event is a universal, organizer-defined happening owned by exactly one
**Community** (an Organization or a Group — see
[community-api.md](community-api.md#what-is-community) for what
"Community" means in this codebase: there is no `Community` entity, it is
either a Root Group or a Child Group). It covers Batizado, Workshop,
Seminar, Roda, Show, Trip, Meeting, Open Training, and fully custom event
types.

An Event is never moved between Communities and is never physically
deleted — every lifecycle transition (Draft → Published → Cancelled/
Finished) is preserved forever in its status history (see
[Domain Models § EventStatusHistory](#eventstatushistory)).

## Scope of this document

Covers everything under `src/events`: the `Event` aggregate itself, its
own Owner/Organizer/Moderator role tier, RSVP/registration (including
registering children), invitations, per-Event guardian assignments, and
check-in (manual and QR). Payments, tickets, a structured schedule,
photo galleries, participant messaging/chat, file attachments, and
certificates are explicitly **out of scope** for this version — the
schema is deliberately shaped so each can be added later without
restructuring existing tables (see each entity's own comments and
[ADR-030](../decisions/ADR-030-event-module-architecture.md)).

---

# General Rules

## Authorization

Every endpoint requires a signed-in user (global `ClerkAuthGuard`, applied
app-wide — see `docs/api/community-api.md#authorization`). Beyond that,
this module has **two independent authorization layers**, deliberately
kept separate (spec: "Oddziel role administracyjne Eventu od ról
Community"):

1. **Community-level** (`GroupPermission`, resolved against the caller's
   `RoleAssignment` for the Event's own Community): gates *creating* an
   Event (`GroupPermission.EVENT_CREATE`) and a narrow oversight override
   (`GroupPermission.EVENT_MODERATE` — cancel any Event under the
   community even without an Event role). Both are Admin/Owner-tier
   Community permissions. See
   [community-api.md](community-api.md#role--permission-reference) for
   the full Community Role → Permission table.
2. **Event-level** (`EventPermission`, resolved against the caller's own
   `EventRoleAssignment`(s) for that *specific* Event — Owner/Organizer/
   Moderator): gates every other write action (edit, publish, cancel,
   finish, manage roles/invitations/participants, check-in).

Reading a specific Event's detail is governed by neither: it depends on
the Event's own `visibility` field, resolved against the caller's
Community membership and/or invitation status (see
[Visibility](#visibility)) — an Organizer/Moderator/Owner can always view
their own Event regardless of its visibility.

### Role → Permission reference (Event-level)

| Permission | Moderator | Organizer | Owner |
|---|---|---|---|
| `EVENT_VIEW_MANAGEMENT` (history, roles list, invitations list, admin participants list) | ✅ | ✅ | ✅ |
| `EVENT_MANAGE_PARTICIPANTS` (waitlist promote, admin participant list) | ✅ | ✅ | ✅ |
| `EVENT_CHECKIN` | ✅ | ✅ | ✅ |
| `EVENT_EDIT` | ❌ | ✅ | ✅ |
| `EVENT_PUBLISH` | ❌ | ✅ | ✅ |
| `EVENT_CANCEL` | ❌ | ✅ | ✅ |
| `EVENT_FINISH` | ❌ | ✅ | ✅ |
| `EVENT_MANAGE_INVITATIONS` | ❌ | ✅ | ✅ |
| `EVENT_MANAGE_MODERATORS` (grant/revoke Moderator) | ❌ | ✅ | ✅ |
| `EVENT_MANAGE_ORGANIZERS` (grant/revoke Organizer) | ❌ | ❌ | ✅ |
| `EVENT_OWNERSHIP_TRANSFER` | ❌ | ❌ | ✅ |

A user may hold more than one Event role at once (e.g. Organizer +
Moderator) — effective permissions are always the **union** of every held
role's permissions, mirroring `GroupPermissionService`.

`GroupPermission.EVENT_MODERATE` additionally satisfies `EVENT_CANCEL`
alone, for a Community Admin/Owner who holds no Event role at all — see
[ADR-030](../decisions/ADR-030-event-module-architecture.md).

## Error format

Identical to the rest of the API — see
[community-api.md § Error format](community-api.md#error-format):
`{ "code": string, "message": string, ...extra }`, thrown via the
appropriate `HttpException` subclass. `EVENT_NOT_FOUND` is returned both
when an Event truly does not exist and when the caller has no usable
relationship to it (no Event role, no qualifying visibility, no Community
oversight override) — the two are indistinguishable by design, the same
convention `GROUP_NOT_FOUND` already follows.

## Identifiers

Every id in this API is the entity's UUID `id`, except where a
`publicCode` is explicitly documented (Event's own shareable/discovery
code — see [community-api.md](community-api.md)). Check-in identity is a
separate system entirely: `User.numericCode`/QR, resolved via
`UserCheckInIdentityService` — see
[Check-in / Attendance](#check-in--attendance). `publicCode` is never used
for check-in.

## Visibility

`Event.visibility` governs both who can **view** the Event and who can
**self-register**:

| Visibility | Who can view | Who can self-register |
|---|---|---|
| `PUBLIC` | Any signed-in user | Any signed-in user |
| `COMMUNITY_MEMBERS` | Active members (or read-only/suspended members) of the Event's Community | Same |
| `INVITE_ONLY` | Only people holding a non-cancelled `EventInvitation`, plus every Event role holder | Only people holding a `PENDING` or `ACCEPTED` `EventInvitation` |

An Event role (Owner/Organizer/Moderator) always grants view access,
regardless of visibility. `DRAFT` Events are visible **only** to their
Event role holders, regardless of visibility — nobody else can see a
Draft, ever, even if its visibility is `PUBLIC`. `CANCELLED`/`FINISHED`
Events remain visible to whoever could already see them — history is
never hidden (see [ADR-007](../decisions/ADR-007-soft-delete.md)).

## Event lifecycle status

```
DRAFT ──publish──> PUBLISHED ──cancel──> CANCELLED
  │                    │  └──finish (manual or lazy, see below)──> FINISHED
  └──cancel───────────>┘
```

- `DRAFT`: only visible/editable by Event role holders. Not registrable.
- `PUBLISHED`: visible per [Visibility](#visibility); registrable.
- `CANCELLED`: terminal. Set from `DRAFT` or `PUBLISHED`. Never registrable.
- `FINISHED`: terminal. Set from `PUBLISHED` only — manually (`POST
  .../finish`) or **lazily**: the next time the Event is loaded by anyone,
  for any reason, once `endsAt` has passed, it is auto-transitioned to
  `FINISHED` (this codebase has no scheduler — see the identical pattern
  for `MembershipSuspension` expiry). Both transitions are recorded in
  [`EventStatusHistory`](#eventstatushistory) identically; the lazy one has
  `actorUserId: null` (nobody performed it).
- Every transition is permanent, in `EventStatusHistory` — **there is no
  delete endpoint for an Event, ever.**
- Check-in is allowed while `PUBLISHED` **and** `FINISHED` (so latecomers
  arriving just after the scheduled end can still be checked in) — never
  while `DRAFT`/`CANCELLED`.

## Where capability flags come from

Every Event response includes a server-computed `capabilities` object (see
[`EventCapabilitiesDto`](#eventcapabilitiesdto)) and the caller's own
`viewerRoles`. **The frontend must never compute a capability from
`viewerRoles` itself** — always read `capabilities` directly (mirrors
`CommunityHomeCapabilitiesDto`'s own rule — see
[community-api.md § Where capability flags come from](community-api.md#where-capability-flags-come-from)).
Unlike Community Home's per-community id-lists, this DTO is already scoped
to one Event, so every flag is a plain boolean.

---

# Endpoints

## Events

### 1. Create Event

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/events` or `/sections/:sectionId/events`

**Description:** Creates a new Event under the given Community (Root or
Child Group), always as `DRAFT`. The caller is automatically granted
`EventRole.OWNER` for the new Event. Dual-mounted the same way
Academies/Cohorts/RoleAssignments are (see [community-api.md](community-api.md#what-is-community))
— both routes resolve identically; `:groupId`/`:sectionId` is only ever
present on whichever route matched.

**Required authorization:** Signed-in user with a usable Role Assignment
for `:groupId`, which must be `ACTIVE`.

**Required permissions:** `GroupPermission.EVENT_CREATE` (Community
Admin/Owner tier).

**Request**

Path: `groupId` (UUID) — the owning Community.

Body (JSON):

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | enum (`FESTIVAL`\|`WORKSHOP`\|`OPEN_RODA`\|`OTHER`) | Yes | Immutable once the Event is created - never part of [Update Event](#4-update-event)'s body. |
| `customTypeLabel` | string (≤100 chars) or `null` | Required iff `type` is `OTHER`; forbidden otherwise | Free-text label for a custom event kind. |
| `name` | string (1-200 chars, trimmed) | Yes | |
| `description` | string (≤5000 chars) or `null` | No | Plain text — no rich text. |
| `coverImageUrl` | URL string (≤2048 chars) or `null` | No | |
| `startsAt` | ISO-8601 datetime | Yes | |
| `endsAt` | ISO-8601 datetime | Yes | Must not be before `startsAt`. |
| `locationName` | string or `null` | No | |
| `locationAddress` | string or `null` | No | |
| `scheduleDays` | array of `{ startsAt, endsAt }` (both ISO-8601 datetime) | No (default `[]`) | Optional per-day breakdown of `startsAt`/`endsAt` for a multi-day Event (e.g. a festival with different hours each day) - purely descriptive, never consulted for RSVP/capacity/waitlist/notifications/calendar filtering, which always use `startsAt`/`endsAt` above. Each day must fall entirely within `startsAt`/`endsAt`, and days must be listed in ascending, non-overlapping order. At most 60 entries. |
| `visibility` | enum (`PUBLIC`\|`COMMUNITY_MEMBERS`\|`INVITE_ONLY`) | Yes | |
| `capacity` | integer ≥1 or `null` | No (default `null`) | `null` = no limit. |
| `waitlistPolicy` | enum (`NONE`\|`AUTOMATIC`\|`MANUAL`) | No (default `NONE`) | Must be `NONE` when `capacity` is `null`. |

**Response** — `201 Created`, body: [`EventResponseDto`](#eventresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body fails schema validation. |
| 404 | `GROUP_NOT_FOUND` | `:groupId` doesn't resolve to a Group the caller has usable authorization for. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `EVENT_CREATE` in this Community. |
| 409 | `GROUP_ARCHIVED` / `GROUP_READ_ONLY` / `GROUP_DELETED` | The Community is not `ACTIVE`. |

---

### 2. List Events

**HTTP Method:** `GET`
**URL:** `/groups/:groupId/events` or `/sections/:sectionId/events`

**Description:** Lists Events under a single Community, filtered by the
caller's own visibility (see [Visibility](#visibility)) unless the caller
holds `GroupPermission.EVENT_VIEW_ALL` (Community Admin/Owner oversight),
in which case every Event is returned regardless of status/visibility.
Every Event the caller holds any Event role for is always included,
regardless of status or visibility (e.g. their own Drafts). See
[Global Events](#global-events) below for the cross-community equivalent.

**Required authorization:** Any signed-in user (open — a `PUBLIC` Event
must remain listable to non-members).

**Required permissions:** None at the route level; visibility is resolved
per-Event inside the service.

**Request**

Path: `groupId` (UUID).

Query:

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | enum `EventStatus` | No | Exact match. |
| `type` | enum `EventType` | No | Exact match. |
| `from` | ISO-8601 datetime | No | Only Events whose `endsAt` is on/after this instant. |
| `to` | ISO-8601 datetime | No | Only Events whose `startsAt` is on/before this instant. |
| `limit` | integer 1-100 | No (default 20) | |
| `offset` | integer ≥0 | No (default 0) | |

**Response** — `200 OK`, body: `{ items: EventResponseDto[], total: number, hasMore: boolean }`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Query fails schema validation. |
| 404 | `GROUP_NOT_FOUND` | `:groupId` doesn't exist. |

---

### 2b. Global Events

**HTTP Method:** `GET`
**URL:** `/events`

**Description:** Lists every Event visible to the caller across **every**
Community they have any relationship to, in one request — the "global
events" feed. Exists so a cross-community Events screen never has to fetch
every Group/Section the caller belongs to and issue one
[List Events](#2-list-events) request per community, merging the results
itself. Applies the exact same per-Event visibility rule as List Events —
`PUBLIC` to anyone, `COMMUNITY_MEMBERS` to active/read-only members of
that specific Event's Community, `INVITE_ONLY` to invitees — resolved
across every Community the caller belongs to (not just one), plus every
Event the caller holds any Event role for, regardless of Community
membership. **Does not** include the `EVENT_VIEW_ALL`/`EVENT_MODERATE`
Community oversight override that List Events applies for a single
community — that remains an Admin/Owner "browse every Draft under the one
community I manage" tool, already served by List Events; this feed only
ever answers "what's relevant to me."

**Required authorization:** Any signed-in user.

**Required permissions:** None — visibility is resolved per-Event, exactly
like List Events.

**Request**

Query: identical to [List Events](#2-list-events) (`status`, `type`,
`from`, `to`, `limit`, `offset`).

**Response** — `200 OK`, body: `{ items: EventResponseDto[], total: number, hasMore: boolean }`.
Each item's own `community` field (see
[`EventCommunityRefDto`](#eventcommunityrefdto)) identifies which Group or
Section it belongs to — the frontend never needs a separate lookup to
group/label results by community.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Query fails schema validation. |

---

### 3. Get Event

**HTTP Method:** `GET`
**URL:** `/events/:eventId`

**Description:** Fetches a single Event by id, subject to
[Visibility](#visibility)/status rules. Flat route — an Event is
independently addressable regardless of which Community it belongs to
(invite links, QR posters).

**Required authorization:** Signed-in user who can see this Event (see
[Visibility](#visibility)) or holds any Event role for it.

**Required permissions:** None at the route level.

**Response** — `200 OK`, body: [`EventResponseDto`](#eventresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` | Doesn't exist, is a Draft the caller holds no role for, or its visibility excludes the caller. |

---

### 4. Update Event

**HTTP Method:** `PATCH`
**URL:** `/events/:eventId`

**Description:** Full-replace update of every editable field *except*
`type`/`customTypeLabel`, which are immutable once the Event is created and
are structurally absent from this body (sending them has no effect - they
are not part of the schema). `status` is also never part of this body — it
only changes through publish/cancel/finish.

**Required authorization:** Event role holder.

**Required permissions:** `EVENT_EDIT`.

**Request** Body: identical shape to [Create Event](#1-create-event)'s body,
minus `type` and `customTypeLabel`.

**Response** — `200 OK`, body: [`EventResponseDto`](#eventresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body fails schema validation. |
| 404 | `EVENT_NOT_FOUND` | Doesn't exist, or caller has no Event role and no oversight override. |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | Caller holds a role but not `EVENT_EDIT`. |
| 409 | `EVENT_CANCELLED` / `EVENT_FINISHED` | Event is not `DRAFT`/`PUBLISHED`. |

---

### 5. Publish Event

**HTTP Method:** `POST`
**URL:** `/events/:eventId/publish`

**Description:** `DRAFT` → `PUBLISHED`. Records an
[`EventStatusHistory`](#eventstatushistory) row.

**Required permissions:** `EVENT_PUBLISH`.

**Response** — `201 Created` (not 200 — this endpoint has no `@HttpCode`
override, so it returns NestJS's default status for `POST`; same
convention as `POST /groups/:id/archive` — see
[community-api.md](community-api.md#5-archive-community)), body:
[`EventResponseDto`](#eventresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | — |
| 409 | `EVENT_PUBLISHED` / `EVENT_CANCELLED` / `EVENT_FINISHED` | Event is not `DRAFT`. |

---

### 6. Cancel Event

**HTTP Method:** `POST`
**URL:** `/events/:eventId/cancel`

**Description:** `DRAFT`/`PUBLISHED` → `CANCELLED`. Also reachable by a
Community Admin/Owner holding `GroupPermission.EVENT_MODERATE`, even
without any Event role — see [ADR-030](../decisions/ADR-030-event-module-architecture.md).

**Required permissions:** `EVENT_CANCEL` (or the `EVENT_MODERATE`
Community override).

**Request** Body: `{ "reason": string (1-1000 chars) or null }` (optional).

**Response** — `201 Created` (no `@HttpCode` override — see [Publish
Event](#5-publish-event)'s note), body: [`EventResponseDto`](#eventresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | Caller holds a role but not `EVENT_CANCEL`, and no oversight override applies. |
| 409 | `EVENT_CANCELLED` / `EVENT_FINISHED` | Event is already terminal. |

---

### 7. Finish Event

**HTTP Method:** `POST`
**URL:** `/events/:eventId/finish`

**Description:** Manually ends a `PUBLISHED` Event early. (Also happens
lazily once `endsAt` passes — see [Event lifecycle status](#event-lifecycle-status).)

**Required permissions:** `EVENT_FINISH`.

**Response** — `201 Created` (no `@HttpCode` override — see [Publish
Event](#5-publish-event)'s note), body: [`EventResponseDto`](#eventresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | — |
| 409 | `EVENT_DRAFT` / `EVENT_CANCELLED` / `EVENT_FINISHED` | Event is not `PUBLISHED`. |

---

### 8. Get Event Status History

**HTTP Method:** `GET`
**URL:** `/events/:eventId/history`

**Description:** Every lifecycle transition, oldest first — see
[`EventStatusHistory`](#eventstatushistory).

**Required permissions:** `EVENT_VIEW_MANAGEMENT` (any Event role).

**Response** — `200 OK`, body: array of [`EventStatusHistoryResponseDto`](#eventstatushistoryresponsedto).

**Possible errors:** `404 EVENT_NOT_FOUND`, `403 INSUFFICIENT_EVENT_PERMISSIONS`.

---

## Roles (Owner / Organizer / Moderator)

### 9. List Event Roles

**HTTP Method:** `GET`
**URL:** `/events/:eventId/roles`

**Description:** Every Owner/Organizer/Moderator role assignment for this
Event. The frontend may collapse these into a single "Organizers" UI
group if desired (spec: the UI only ever shows "Organizers" and
"Participants" groups) — the backend still exposes the granular role.

**Required permissions:** `EVENT_VIEW_MANAGEMENT`.

**Response** — `200 OK`, body: array of [`EventRoleAssignmentResponseDto`](#eventroleassignmentresponsedto).

---

### 10. Grant Event Role

**HTTP Method:** `POST`
**URL:** `/events/:eventId/roles`

**Description:** Grants `ORGANIZER` or `MODERATOR` to a Community member.
`OWNER` is never grantable here — see [Transfer Ownership](#12-transfer-event-ownership).
Granting `ORGANIZER` specifically requires the caller to be the current
`OWNER` (checked in the service, beyond what the route guard requires);
granting `MODERATOR` requires only `EVENT_MANAGE_MODERATORS` (Organizer or
Owner).

**Required permissions:** `EVENT_MANAGE_MODERATORS` (route-level minimum;
see above for the finer-grained rule).

**Request** Body: `{ "userId": UUID, "role": "ORGANIZER" | "MODERATOR" }`.

**Response** — `201 Created`, body: [`EventRoleAssignmentResponseDto`](#eventroleassignmentresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | — |
| 404 | `EVENT_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | Caller lacks the route permission, or tries to grant `ORGANIZER` without being `OWNER`. |
| 409 | `EVENT_ROLE_TARGET_NOT_COMMUNITY_MEMBER` | Target user has no active membership in this Event's Community. |
| 409 | `EVENT_ROLE_ALREADY_EXISTS` | Target already holds this exact role for this Event. |

---

### 11. Revoke Event Role

**HTTP Method:** `DELETE`
**URL:** `/events/:eventId/roles/:roleAssignmentId`

**Description:** Revokes a single role assignment. `OWNER` can never be
revoked here (use Transfer Ownership). Revoking `ORGANIZER` requires the
caller to be `OWNER`; revoking `MODERATOR` requires `EVENT_MANAGE_MODERATORS`.

**Required permissions:** `EVENT_MANAGE_MODERATORS` (route-level minimum).

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` / `EVENT_ROLE_ASSIGNMENT_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | Trying to revoke `ORGANIZER` without being `OWNER`. |
| 409 | `CANNOT_REMOVE_EVENT_OWNER` | Target role is `OWNER`. |

---

### 12. Transfer Event Ownership

**HTTP Method:** `POST`
**URL:** `/events/:eventId/transfer-ownership`

**Description:** Atomically moves `OWNER` from the caller to another
Community member (spec: "Owner może przekazać własność"). The caller must
be the *current* Owner; the target must already have an active membership
in the Event's Community.

**Required permissions:** `EVENT_OWNERSHIP_TRANSFER` (Owner only).

**Request** Body: `{ "toUserId": UUID }`.

**Response** — `201 Created` (no `@HttpCode` override — see [Publish
Event](#5-publish-event)'s note), body: [`EventRoleAssignmentResponseDto`](#eventroleassignmentresponsedto) (the new Owner's row).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | — |
| 404 | `EVENT_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | — |
| 409 | `NOT_CURRENT_EVENT_OWNER` | Race: caller's Owner row was already transferred away. |
| 409 | `CANNOT_TRANSFER_TO_SELF` | — |
| 409 | `EVENT_ROLE_TARGET_NOT_COMMUNITY_MEMBER` | — |

---

## Invitations

### 13. List Event Invitations

**HTTP Method:** `GET`
**URL:** `/events/:eventId/invitations`

**Description:** Every invitation, newest first — including terminal ones
(the "Oczekujący" UI group is simply the subset with `status: PENDING`).

**Required permissions:** `EVENT_VIEW_MANAGEMENT`.

**Response** — `200 OK`, body: array of [`EventInvitationResponseDto`](#eventinvitationresponsedto).

---

### 14. Create Event Invitation

**HTTP Method:** `POST`
**URL:** `/events/:eventId/invitations`

**Description:** Invites a specific person, by existing account (`userId`)
or by email (for someone without an account yet). Required before
registration for `INVITE_ONLY` Events; optional (a courtesy notification)
for `PUBLIC`/`COMMUNITY_MEMBERS` Events.

**Required permissions:** `EVENT_MANAGE_INVITATIONS`.

**Request** Body: exactly one of:

| Field | Type | Description |
|---|---|---|
| `userId` | UUID | Invite an existing account. |
| `email` | email string (≤255 chars) | Invite by email. |

**Response** — `201 Created`, body: [`EventInvitationResponseDto`](#eventinvitationresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Neither or both of `userId`/`email` given. |
| 404 | `EVENT_NOT_FOUND` / `USER_NOT_FOUND` | `userId` doesn't resolve to a real account. |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | — |
| 409 | `EVENT_INVITATION_ALREADY_PENDING` | This person already has a pending invitation. |

---

### 15. Cancel Event Invitation

**HTTP Method:** `DELETE`
**URL:** `/events/:eventId/invitations/:invitationId`

**Description:** Withdraws a still-`PENDING` invitation.

**Required permissions:** `EVENT_MANAGE_INVITATIONS`.

**Response** — `204 No Content`.

**Possible errors:** `404 EVENT_NOT_FOUND` / `EVENT_INVITATION_NOT_FOUND`, `403 INSUFFICIENT_EVENT_PERMISSIONS`, `409 EVENT_INVITATION_NOT_PENDING`.

---

### 16. Decline Event Invitation

**HTTP Method:** `POST`
**URL:** `/events/:eventId/invitations/:invitationId/decline`

**Description:** Self-service: the invited person declining without ever
registering. Not gated by any Event role — the invitee usually holds
none.

**Required authorization:** Must be the invitation's `invitedUser` (or
its `invitedEmail` matching the caller's own email).

**Response** — `201 Created` (no body semantics beyond success — `void`).

**Possible errors:** `404 EVENT_NOT_FOUND` / `EVENT_INVITATION_NOT_FOUND`, `403 NOT_YOUR_INVITATION`, `409 EVENT_INVITATION_NOT_PENDING`.

---

## Registration, RSVP & Participants

### 17. Register for Event

**HTTP Method:** `POST`
**URL:** `/events/:eventId/register`

**Description:** Self-service. Registers the caller (optionally) and/or
any number of their children in one call (spec: "czy sam bierze udział,
które dzieci zapisuje"). Re-registering someone already registered updates
their RSVP in place rather than duplicating a row. For `INVITE_ONLY`
Events, this also implicitly accepts the caller's own pending invitation.
See [Registration & RSVP workflow](#registration--rsvp-workflow) and
[Capacity & waitlist](#capacity--waitlist).

**Required authorization:** Any signed-in user; eligibility resolved from
the Event's own visibility/membership/invitation state (see
[Visibility](#visibility)) — never from an Event role.

**Request** Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `attendSelf` | boolean | No (default `true`) | Whether the caller themselves attends. |
| `selfRsvpStatus` | enum (`GOING`\|`MAYBE`) | No (default `GOING`) | Only used when `attendSelf` is true. |
| `children` | array (≤20 items) | No (default `[]`) | See below. |

Each `children[]` item is one of:

| Shape | Fields | Notes |
|---|---|---|
| Child with own account | `{ "subjectType": "CHILD_ACCOUNT", "childUserId": UUID }` | **Currently always rejected** with `CHILDREN_DIRECTORY_NOT_AVAILABLE` — see [Open items](#open-items). |
| Child without an account | `{ "subjectType": "CHILD_DEPENDENT", "displayName": string (1-150 chars) }` | Fully functional; the name is stored only against this one registration. |

At least one of `attendSelf`/`children` must apply.

**Response** — `201 Created`, body: array of [`EventAttendeeResponseDto`](#eventattendeeresponsedto) (one per person registered/updated in this call).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | — |
| 404 | `EVENT_NOT_FOUND` | — |
| 403 | `EVENT_REGISTRATION_NOT_ALLOWED` | Visibility/membership/invitation rules exclude the caller. |
| 409 | `EVENT_DRAFT` / `EVENT_CANCELLED` / `EVENT_FINISHED` | Event is not `PUBLISHED`. |
| 409 | `CHILDREN_DIRECTORY_NOT_AVAILABLE` | A `CHILD_ACCOUNT` entry was included. |
| 409 | `EVENT_FULL` | No capacity and no (or exhausted) waitlist. |

---

### 18. Update RSVP

**HTTP Method:** `PATCH`
**URL:** `/events/:eventId/rsvp/:attendeeId`

**Description:** Changes an existing registration's RSVP decision — any
number of times (spec: "Dowolną liczbę razy"). Only the person who
originally registered this attendee (`registeredBy`) may call this — not
the child themselves, not an Organizer (see [Open items](#open-items) for
why there is no organizer-initiated equivalent yet).

**Request** Body: `{ "rsvpStatus": "GOING" | "MAYBE" | "NOT_GOING" }`.

**Response** — `200 OK`, body: [`EventAttendeeResponseDto`](#eventattendeeresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | — |
| 404 | `EVENT_NOT_FOUND` / `EVENT_ATTENDEE_NOT_FOUND` | — |
| 403 | `NOT_YOUR_REGISTRATION` | Caller isn't this attendee's `registeredBy`. |
| 409 | `EVENT_DRAFT` / `EVENT_CANCELLED` / `EVENT_FINISHED` | Event is not `PUBLISHED`. |

---

### 19. List My Registrations

**HTTP Method:** `GET`
**URL:** `/events/:eventId/my-registrations`

**Description:** Every attendee row the caller registered (themselves
and/or their children) for this Event.

**Response** — `200 OK`, body: array of [`EventAttendeeResponseDto`](#eventattendeeresponsedto).

---

### 20. List Participants (admin)

**HTTP Method:** `GET`
**URL:** `/events/:eventId/participants`

**Description:** Every attendee for this Event, with full RSVP/waitlist/
check-in detail — the "Uczestnicy" management view.

**Required permissions:** `EVENT_MANAGE_PARTICIPANTS`.

**Response** — `200 OK`, body: array of [`EventAttendeeResponseDto`](#eventattendeeresponsedto).

---

### 21. Promote from Waitlist

**HTTP Method:** `POST`
**URL:** `/events/:eventId/participants/:attendeeId/promote`

**Description:** Manually promotes one waitlisted attendee to a claimed
seat — only valid when `waitlistPolicy` is `MANUAL` (spec: "organizator
sam wybiera osoby z listy rezerwowej").

**Required permissions:** `EVENT_MANAGE_PARTICIPANTS`.

**Response** — `201 Created` (no `@HttpCode` override — see [Publish
Event](#5-publish-event)'s note), body: [`EventAttendeeResponseDto`](#eventattendeeresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` / `EVENT_ATTENDEE_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | — |
| 409 | `EVENT_NOT_MANUAL_WAITLIST` | `waitlistPolicy` isn't `MANUAL`. |
| 409 | `ATTENDEE_NOT_WAITLISTED` | — |

---

## Guardians

### 22. List Event Guardians

**HTTP Method:** `GET`
**URL:** `/events/:eventId/guardians`

**Description:** Every currently-active guardian assignment for this
Event (see [`EventGuardianAssignment`](#eventguardianassignment)).

**Required permissions:** `EVENT_MANAGE_PARTICIPANTS`.

**Response** — `200 OK`, body: array of [`EventGuardianAssignmentResponseDto`](#eventguardianassignmentresponsedto).

---

### 23. Assign/Reassign Guardian

**HTTP Method:** `POST`
**URL:** `/events/:eventId/attendees/:attendeeId/guardian`

**Description:** Sets (or replaces) the active guardian for a child
attendee. A guardian must be a real app user; they do **not** need to be a
participant of the Event themselves (spec: "nie musi być uczestnikiem
Eventu"). Reassigning revokes the previous active assignment and inserts
a new one — history is preserved. Currently an organizer-only
administrative action — see [Open items](#open-items) for the
self-service variant this could grow into.

**Required permissions:** `EVENT_MANAGE_PARTICIPANTS`.

**Request** Body: `{ "guardianUserId": UUID }`.

**Response** — `201 Created`, body: [`EventGuardianAssignmentResponseDto`](#eventguardianassignmentresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | — |
| 404 | `EVENT_NOT_FOUND` / `EVENT_ATTENDEE_NOT_FOUND` / `USER_NOT_FOUND` | — |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | — |
| 409 | `ATTENDEE_NOT_A_CHILD` | Target attendee's `subjectType` is `SELF`. |

---

### 24. Revoke Guardian

**HTTP Method:** `DELETE`
**URL:** `/events/:eventId/attendees/:attendeeId/guardian`

**Description:** Revokes the active guardian assignment without
replacing it.

**Required permissions:** `EVENT_MANAGE_PARTICIPANTS`.

**Response** — `204 No Content`.

**Possible errors:** `404 EVENT_NOT_FOUND` / `EVENT_GUARDIAN_ASSIGNMENT_NOT_FOUND`, `403 INSUFFICIENT_EVENT_PERMISSIONS`.

---

## Check-in / Attendance

The sole check-in system — identity is always `User.numericCode`/QR
(`capohub:v1:u:<numericCode>`), resolved through the same
`UserCheckInIdentityService` Training check-in also uses. `publicCode` is
never used for check-in. Attendance (the recorded fact of presence) lives
directly on `EventAttendee` (`checkedIn`/`checkedInAt`/`checkedInBy`/
`checkInMethod`) — a distinct fact from RSVP (declared intent); there is no
separate `EventAttendance` table.

**Tri-state per attendee:** `recordedAt == null` → never recorded;
`recordedAt != null && attended == true` → present; `recordedAt != null &&
attended == false` → explicitly marked absent.

### 25. Identify Check-in Candidates

**HTTP Method:** `POST`
**URL:** `/events/:eventId/attendance/identify`

**Description:** Resolves a scanned/typed identity to a User, then reports
their own registration for this Event (if any) **and** every child they
are the *active* guardian for on this Event (see
[`EventGuardianAssignment`](#eventguardianassignment)) — a guardian need
not be a participant themselves. **Zero mutation** — `checkedIn`/
`checkedInAt` are never touched by this call. The frontend uses the result
to let the operator pick exactly who actually showed up, then calls
[Record Attendance](#27-record-attendance-by-user) /
[Record Attendance by Attendee](#28-record-attendance-by-attendee) per
person.

**Required permissions:** `EVENT_CHECKIN` (same level as actually
recording attendance — identifying candidates is the same organizational
action).

**Request** Body: `{ "identity": string }` — a numeric code (`"123456"`,
`"123-456"`, or the display form `"U123-456"`) or a User QR payload
(`"capohub:v1:u:123456"`).

**Response** — `201 Created`, body: `EventAttendanceIdentifyResponseDto`
(`{ user, selfAttendee, childrenUnderGuardianship }` — see
[DTO Reference](#eventattendanceidentifyresponsedto)).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_CHECK_IN_IDENTITY` | Identity is neither a valid code nor a valid QR payload. |
| 400 | `WRONG_IDENTITY_TYPE` | Identity is an Event QR payload, not a User one. |
| 404 | `EVENT_NOT_FOUND` | — |
| 404 | `USER_NOT_FOUND` | No user matches a well-formed identity. |
| 404 | `EVENT_ATTENDEE_NOT_FOUND` | The resolved User has no registration of their own *and* is guardian of nobody on this Event. |
| 403 | `INSUFFICIENT_EVENT_PERMISSIONS` | — |
| 409 | `EVENT_DRAFT` / `EVENT_CANCELLED` | Event is neither `PUBLISHED` nor `FINISHED`. |
| 409 | `EVENT_NOT_STARTED` | Before `startsAt`. |

---

### 26. List Attendance Roster

**HTTP Method:** `GET`
**URL:** `/events/:eventId/attendance`

**Description:** Every `EventAttendee` for this Event with RSVP and
attendance side by side. `attendeeId` on each row is required to address a
`CHILD_DEPENDENT` (no `user.id`) via
[Record Attendance by Attendee](#28-record-attendance-by-attendee).

**Required permissions:** `EVENT_VIEW_MANAGEMENT`.

**Response** — `200 OK`, body: `{ event: { id, name }, items: EventAttendanceEntryDto[] }`.

**Possible errors:** `404 EVENT_NOT_FOUND`, `403 INSUFFICIENT_EVENT_PERMISSIONS`.

---

### 27. Record Attendance by User

**HTTP Method:** `PUT`
**URL:** `/events/:eventId/attendance/:userId`

**Description:** Sets a specific User's own attendance explicitly (present
or absent). Only ever the User's own `EventAttendee` — never a child.

**Required permissions:** `EVENT_CHECKIN`.

**Request** Body: `{ "attended": boolean }`.

**Response** — `200 OK`, body: `EventAttendanceEntryDto`.

**Possible errors:** `404 EVENT_NOT_FOUND` / `EVENT_ATTENDEE_NOT_FOUND`, `403 INSUFFICIENT_EVENT_PERMISSIONS`, `409 EVENT_DRAFT` / `EVENT_CANCELLED` / `EVENT_NOT_STARTED`.

---

### 28. Record Attendance by Attendee

**HTTP Method:** `PUT`
**URL:** `/events/:eventId/attendance/attendees/:attendeeId`

**Description:** Same write as [#27](#27-record-attendance-by-user), but
addressed by `EventAttendee.id` instead of `User.id` — the only way to
record attendance for a `CHILD_DEPENDENT` attendee, which has no `User.id`
of its own. Also works for any other attendee (`SELF`/`CHILD_ACCOUNT`).

**Required permissions:** `EVENT_CHECKIN`.

**Request** Body: `{ "attended": boolean }`.

**Response** — `200 OK`, body: `EventAttendanceEntryDto`.

**Possible errors:** `404 EVENT_NOT_FOUND` / `EVENT_ATTENDEE_NOT_FOUND`, `403 INSUFFICIENT_EVENT_PERMISSIONS`, `409 EVENT_DRAFT` / `EVENT_CANCELLED` / `EVENT_NOT_STARTED`.

---

### 29. Check-in

**HTTP Method:** `POST`
**URL:** `/events/:eventId/check-in`

**Description:** The fast path — resolves `identity` to a User, requires
that User to already have their own `EventAttendee` (never auto-creates
one), and marks **only that User** present. Never selects/checks in a
child under their guardianship, even if they have none of their own — use
[Identify](#25-identify-check-in-candidates) + attendee-based PUT for
that. Idempotent: re-scanning someone already present changes nothing and
is never an error — see `alreadyCheckedIn`.

**Required permissions:** `EVENT_CHECKIN`.

**Request** Body: `{ "identity": string }` (same shape as
[Identify](#25-identify-check-in-candidates)).

**Response** — `201 Created`, body: `EventCheckInResultDto`
(`{ user, attended: true, recordedAt, alreadyCheckedIn }`).

**Possible errors:** same table as [#25](#25-identify-check-in-candidates),
plus `404 EVENT_ATTENDEE_NOT_FOUND` whenever the resolved User has no
registration of their own (guardian-only identities are rejected here,
not silently redirected to a child).

---

# Registration & RSVP workflow

1. A Community member (or, for `PUBLIC` Events, any signed-in user) calls
   [Register](#17-register-for-event) with `attendSelf` and/or `children`.
2. For `INVITE_ONLY` Events, this requires an existing `PENDING`/`ACCEPTED`
   `EventInvitation` for the caller — registering implicitly accepts a
   `PENDING` one.
3. Each person registered gets one `EventAttendee` row, either seated or
   waitlisted depending on [capacity](#capacity--waitlist).
4. Each child attendee automatically gets an
   [`EventGuardianAssignment`](#eventguardianassignment) with the
   registering parent as guardian.
5. The registrant may change any attendee's RSVP any number of times via
   [Update RSVP](#18-update-rsvp), including to `NOT_GOING` (which frees
   their seat/waitlist slot).

# Capacity & waitlist

- `capacity: null` → unlimited, `waitlistPolicy` is forced to `NONE`.
- A seat is claimed by any `GOING` or `MAYBE` (not `NOT_GOING`),
  non-waitlisted attendee — `seatsTaken`/`seatsAvailable`/`waitlistCount`
  on [`EventResponseDto`](#eventresponsedto) reflect this live.
- When capacity is full at registration time:
  - `waitlistPolicy: NONE` → registration is rejected (`EVENT_FULL`).
  - `waitlistPolicy: AUTOMATIC` → the registrant is waitlisted; the moment
    a seat frees up (someone sets `NOT_GOING`), the earliest-waitlisted
    attendee is promoted automatically.
  - `waitlistPolicy: MANUAL` → the registrant is waitlisted; an Organizer/
    Moderator must explicitly call [Promote](#21-promote-from-waitlist).

---

# DTO Reference

## Response DTOs

### EventResponseDto

| Field | Type |
|---|---|
| `id` | UUID |
| `community` | [`EventCommunityRefDto`](#eventcommunityrefdto) |
| `createdByUserId` | UUID or `null` |
| `type` | `EventType` |
| `customTypeLabel` | string or `null` |
| `name` | string |
| `description` | string or `null` |
| `coverImageUrl` | string or `null` |
| `startsAt` / `endsAt` | ISO-8601 string |
| `isMultiDay` | boolean — derived from `startsAt`/`endsAt`, never stored |
| `locationName` / `locationAddress` | string or `null` |
| `scheduleDays` | array of `{ startsAt, endsAt }` (both ISO-8601 string) — `[]` for the common single-day Event, always sorted ascending by `startsAt` |
| `visibility` | `EventVisibility` |
| `status` | `EventStatus` |
| `capacity` | integer or `null` |
| `waitlistPolicy` | `EventWaitlistPolicy` |
| `seatsTaken` | integer |
| `seatsAvailable` | integer or `null` (`null` iff `capacity` is `null`) |
| `waitlistCount` | integer |
| `publicCode` | string or `null` |
| `viewerRoles` | `EventRole[]` — the caller's own roles, `[]` if none |
| `capabilities` | [`EventCapabilitiesDto`](#eventcapabilitiesdto) |
| `createdAt` / `updatedAt` | ISO-8601 string |

### EventCommunityRefDto

| Field | Type |
|---|---|
| `id` | UUID |
| `name` | string |
| `logoUrl` | string or `null` |
| `isRootGroup` | boolean |

### EventCapabilitiesDto

| Field | Meaning |
|---|---|
| `canViewManagement` | Any Event role held |
| `canEdit` | `EVENT_EDIT` |
| `canPublish` | `EVENT_PUBLISH` |
| `canCancel` | `EVENT_CANCEL`, or the Community `EVENT_MODERATE` override |
| `canFinish` | `EVENT_FINISH` |
| `canManageOrganizers` | `EVENT_MANAGE_ORGANIZERS` |
| `canManageModerators` | `EVENT_MANAGE_MODERATORS` |
| `canTransferOwnership` | `EVENT_OWNERSHIP_TRANSFER` |
| `canManageInvitations` | `EVENT_MANAGE_INVITATIONS` |
| `canManageParticipants` | `EVENT_MANAGE_PARTICIPANTS` |
| `canCheckIn` | `EVENT_CHECKIN` |
| `canRegister` | Self-registration eligibility (visibility/membership/invitation) — independent of any Event role |

### EventAttendeeResponseDto

| Field | Type |
|---|---|
| `id` | UUID |
| `eventId` | UUID |
| `registeredByUserId` | UUID |
| `subjectType` | `SELF` \| `CHILD_ACCOUNT` \| `CHILD_DEPENDENT` |
| `subjectUserId` | UUID or `null` (set for `SELF`/`CHILD_ACCOUNT`) |
| `displayName` | string — the subject User's `displayName`, or `dependentDisplayName` for `CHILD_DEPENDENT` |
| `rsvpStatus` | `GOING` \| `MAYBE` \| `NOT_GOING` |
| `registeredAt` | ISO-8601 string |
| `isWaitlisted` | boolean |
| `waitlistedAt` / `promotedAt` | ISO-8601 string or `null` |
| `checkedIn` | boolean |
| `checkedInAt` | ISO-8601 string or `null` |
| `checkedInByUserId` | UUID or `null` |
| `checkInMethod` | `QR` \| `MANUAL` \| `null` |
| `guardianUserId` | UUID or `null` — this attendee's currently active guardian, if any |

### EventInvitationResponseDto

| Field | Type |
|---|---|
| `id` | UUID |
| `eventId` | UUID |
| `invitedByUserId` | UUID |
| `invitedUserId` | UUID or `null` |
| `invitedEmail` | string or `null` |
| `status` | `PENDING` \| `ACCEPTED` \| `DECLINED` \| `CANCELLED` |
| `createdAt` / `respondedAt` | ISO-8601 string / string or `null` |

### EventRoleAssignmentResponseDto

| Field | Type |
|---|---|
| `id` | UUID |
| `eventId` | UUID |
| `userId` | UUID |
| `role` | `OWNER` \| `ORGANIZER` \| `MODERATOR` |
| `grantedAt` | ISO-8601 string |
| `grantedByUserId` | UUID or `null` |

### EventGuardianAssignmentResponseDto

| Field | Type |
|---|---|
| `id` | UUID |
| `eventId` | UUID |
| `attendeeId` | UUID |
| `guardianUserId` | UUID |
| `assignedByUserId` | UUID |
| `assignedAt` | ISO-8601 string |
| `revokedAt` | ISO-8601 string or `null` |

### EventStatusHistoryResponseDto

| Field | Type |
|---|---|
| `id` | UUID |
| `eventId` | UUID |
| `fromStatus` | `EventStatus` or `null` |
| `toStatus` | `EventStatus` |
| `actorUserId` | UUID or `null` (`null` = system-reconciled, see [lifecycle status](#event-lifecycle-status)) |
| `reason` | string or `null` |
| `createdAt` | ISO-8601 string |

### EventAttendanceEntryDto

The slim attendance shape used by the roster, identify, and both
attendance-mutation endpoints (§25-28) — deliberately never the full
[`EventAttendeeResponseDto`](#eventattendeeresponsedto) (no RSVP/waitlist/
check-in-device detail, no email/phone/clerkUserId).

| Field | Type |
|---|---|
| `attendeeId` | UUID (`EventAttendee.id`) |
| `user` | `{ id: UUID \| null, displayName: string }` — `id` is `null` only for a `CHILD_DEPENDENT` |
| `rsvpStatus` | `EventRsvpStatus` |
| `attended` | boolean |
| `recordedAt` | ISO-8601 string or `null` — see the tri-state rule at the top of [Check-in / Attendance](#check-in--attendance) |

### EventAttendanceIdentifyResponseDto

| Field | Type |
|---|---|
| `user` | `{ id: UUID, displayName: string }` — whoever the scanned identity resolved to |
| `selfAttendee` | [`EventAttendanceEntryDto`](#eventattendanceentrydto) or `null` |
| `childrenUnderGuardianship` | `EventAttendanceEntryDto[]` |

### EventCheckInResultDto

| Field | Type |
|---|---|
| `user` | `{ id: UUID \| null, displayName: string }` |
| `attended` | always `true` |
| `recordedAt` | ISO-8601 string |
| `alreadyCheckedIn` | boolean — `true` when this scan changed nothing (already present) |

## Request DTOs (bodies)

See each endpoint above for its exact body shape and validation rules;
every request body is Zod-validated and rejected with `400
VALIDATION_ERROR` (field-level errors) on failure, per
[community-api.md § Error format](community-api.md#error-format).

---

# Domain Models

## Event

Belongs to exactly one Community (`community: Group`, Root or Child —
never a discriminator column, see
[community-api.md](community-api.md#what-is-community)), never moved
afterwards. Owns its own `EventRoleAssignment` tier, its own
`EventStatusHistory`, and is referenced by `EventAttendee`/
`EventInvitation`/`EventGuardianAssignment`. Never physically deleted.

## EventRoleAssignment

Owner/Organizer/Moderator, independent of Community roles — see
[ADR-030](../decisions/ADR-030-event-module-architecture.md). Exactly one
active `OWNER` per Event. A user may hold several roles for the same
Event at once.

## EventAttendee

One row per person's (or child's) participation — the "Uczestnik". Never
deleted; `NOT_GOING` is a value, not a removal. `subjectType` is `SELF`,
`CHILD_ACCOUNT` (a child with their own User account — currently
unreachable, see [Open items](#open-items)), or `CHILD_DEPENDENT` (a child
with no account, captured as free text scoped to this one row).

## EventInvitation

Dual invited-user/invited-email pattern (mirrors `MembershipRequest`).
Required to register for `INVITE_ONLY` Events; optional courtesy
notification otherwise. Accepting is implicit (via registration);
declining is explicit.

## EventGuardianAssignment

"Opiekun wydarzenia" — deliberately separate from any (non-existent)
global parent → child relationship. Scoped to one Event and one child
`EventAttendee` row; exactly one active guardian per child per Event. The
guardian must be a real app user and does not need to be a participant of
the Event themselves.

## EventStatusHistory

Append-only lifecycle log — every Draft/Published/Cancelled/Finished
transition, who did it (or `null` for the lazy auto-Finish), and an
optional reason (e.g. cancellation reason). Deliberately separate from
`AuditLogEntry` — see
[ADR-030](../decisions/ADR-030-event-module-architecture.md).

---

# Capability Flags

See [`EventCapabilitiesDto`](#eventcapabilitiesdto) above for the full
table — every flag is computed server-side and must be read directly by
the frontend, never derived from `viewerRoles`.

---

# Open items not determinable from the code

These are deliberate, disclosed gaps — not oversights — each with a
documented reason in the relevant service/entity file:

1. **`CHILD_ACCOUNT` registration is inert.** Registering a child who
   already has their own app account requires verifying the caller is
   actually that child's parent, which requires a parent → child
   relationship that does not exist anywhere in this codebase yet (see
   `children-directory.port.ts` and
   [ADR-030](../decisions/ADR-030-event-module-architecture.md)). Every
   such attempt is rejected today with `CHILDREN_DIRECTORY_NOT_AVAILABLE`.
   This is a business decision (who owns the Children/Family module, what
   its data model looks like) that should not be guessed at here.
2. **"List my children" is not offered.** For the same reason as above,
   there is no endpoint to list a parent's existing children to pre-fill
   the registration UI — the frontend has no source for this today.
3. **Guardian reassignment is organizer-only.** `POST/DELETE
   /events/:eventId/attendees/:attendeeId/guardian` currently require
   `EVENT_MANAGE_PARTICIPANTS`. A self-service "let me hand my child's
   guardianship to another parent directly" flow (without an Organizer's
   involvement) is a reasonable future addition but was not built in this
   pass — organizers can perform the reassignment on request today.
4. **No organizer-initiated RSVP change.** Only the person who registered
   an attendee (`registeredBy`) can change that attendee's RSVP — an
   Organizer cannot do it on a participant's behalf. Not requested by the
   spec, and deliberately not added (the spec is explicit that
   organizers do not manually manage participants).
5. **`isMultiDay` uses UTC calendar-day comparison.** Since `Event` has no
   per-record time zone (unlike `Group.timezone`), a boundary event (e.g.
   23:00–01:00 local time) can disagree with the organizer's own
   intuition about whether it "spans two days". No better reference frame
   is available without adding a time zone field, which was not
   requested.
6. **List filtering does one extra DB round-trip per Event for
   `canRegister`.** `EventsService.list` resolves Community membership
   once for the whole request, but still calls
   `EventAccessService.canViewerRegister` per Event to build each row's
   `capabilities.canRegister` — correct, but not optimized for very large
   result pages. Flagged as a possible future performance pass, not a
   correctness issue.
7. **A pre-existing, unrelated schema/entity drift was observed, not
   fixed.** `Group.publicCode`/`User.publicCode` are declared `nullable:
   true` in their entity classes, but the database columns are `NOT
   NULL` (from an earlier backfill migration). `mikro-orm schema:update
   --dump` reports this drift independently of anything in this module.
   It was deliberately left alone — reversing a `NOT NULL` constraint as
   a side effect of an unrelated feature migration would be an
   unreviewed, out-of-scope change.
