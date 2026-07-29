---
title: Community API
description: Complete API reference for the Community module, generated from the current backend implementation (src/groups, src/discovery). Backend is the source of truth.
status: Generated from implementation
last_updated: 2026-07-24
---

# Community API

> **Terminology note (2026-07-28):** the backend underwent the Group/Section
> domain rename (see
> [ADR-031](../decisions/ADR-031-group-section-domain-rename.md)) after this
> document was last generated - endpoints and field names below may be
> stale (e.g. `/organizations/*` never existed; former Child Group routes
> moved to `/sections/*`; `isOrganization` is now `isRootGroup`). This
> document needs a full regeneration pass against the current backend -
> treat the source code as authoritative until then.

This document is the complete API reference for the **Community** module. It
is generated directly from the current backend implementation
(`src/groups/*`, `src/discovery/*`). Frontend engineers should be able to
implement every Community screen from this document alone, without reading
backend source code.

If anything in this document ever appears to contradict the backend, the
backend's actual behavior is correct — this document should be updated to
match it, not the other way around.

## What is Community?

**Community is a product/UI concept, not a backend concept.** There is no
`Community` entity, table, or controller anywhere in the backend. Every
endpoint in this document operates on the `Group` entity (see
[Domain Models](#domain-models)). "Community" is simply the umbrella term the
product uses for "an Organization or a Group" when the distinction doesn't
matter to the screen being built.

## What is Organization?

An **Organization** is a `Group` with `parentGroupId == null` (a "Root
Group"). There is no separate Organization entity or table — a Root Group
*is* the Organization. Every endpoint that returns a `Group`-shaped object
lets you detect this the same way: `parentGroupId === null`.

## What is Group?

A **Group** (in the narrower, "Child Group" sense the product UI uses) is
any `Group` row with a non-null `parentGroupId`. Structurally it is the
exact same entity as an Organization — same table, same fields, same
endpoints — it simply has a parent. The backend places **no limit on
hierarchy depth**: a Group's parent can itself be a Child Group of another
Organization, arbitrarily deep. There is currently no endpoint that changes
a Group's parent after creation — `parentGroupId` is fixed for the entity's
entire lifetime.

## Scope of this document

This document covers every endpoint needed to build the Community module's
screens: Groups (create/read/update/lifecycle, including permanent
deletion), Memberships (including Ban/Unban and Suspend/Unsuspend),
Invitations, Join Requests, Role Assignments, the Community Audit Log,
Community Notification settings, Discovery, and the Community Home
dashboard.

**Explicitly out of scope** (not part of the Community module per
`docs/architecture/PAD-001-community.md`, even though their controllers live
in the same backend module): full CRUD for **Academies**
(`AcademiesController`) and **Sections** (`SectionsController`) as
standalone resources. The two endpoints that assign/unassign a *member* to
a Section are documented here (they are part of Membership management), but
creating, listing, editing, or archiving a Section itself is not.

---

# General Rules

## Authorization

Every endpoint in this document requires a signed-in user, sent as a Clerk
session token:

```
Authorization: Bearer <clerk-session-token>
```

There is no endpoint in this module marked `@Public()`. A missing, malformed,
or invalid token always results in `401 Unauthorized` with body
`{ "message": "Authentication required" }` (see `ClerkAuthGuard`), before any
other logic runs — including `GET /discovery/groups`, which needs a signed-in
user to compute `isMember`/`hasPendingRequest` even though it's a "browse"
screen.

The authenticated user is resolved once per request and is always the actor
for every action — **no endpoint accepts a `userId`/`actorId` from the
client to act on someone else's behalf.** Where an endpoint needs to *name*
another user (invite them, add them as a member, transfer ownership to
them), that user is always the *target*, never the actor performing the
call.

## Error format

Every error response (from `HttpExceptionFilter`) has this shape:

```json
{
  "statusCode": 404,
  "code": "GROUP_NOT_FOUND",
  "message": "Group not found",
  "path": "/api/v1/groups/8f14e...",
  "timestamp": "2026-07-22T10:00:00.000Z"
}
```

- `statusCode` — the HTTP status code.
- `code` — a stable, machine-readable string. This is what frontend code
  should switch/branch on, never `message`.
- `message` — human-readable, may change wording over time.
- `path`, `timestamp` — always present.
- `errors` — present **only** on `400 VALIDATION_ERROR` responses (body
  failed Zod validation): an array of `{ "field": string, "message": string }`,
  one per failed field. `field` is a dot path (e.g. `"contactEmail"`), or
  the literal string `"(root)"` for a schema-level error not tied to one
  field.
- `duplicates` — reserved for a Songs-module error code, never present on
  any Community endpoint.

**`HttpExceptionFilter` only ever forwards `statusCode`/`code`/`message`/
`path`/`timestamp`/`errors`/`duplicates` to the actual JSON response — any
other property a service attaches to its thrown exception (e.g.
`ownedGroupIds`, `childGroupIds`) is silently dropped and **never reaches
the client**, even though it exists on the exception object internally.
Concretely: `OWNER_MUST_TRANSFER_OWNERSHIP`, `CANNOT_REMOVE_OWNER`,
`CANNOT_BAN_OWNER`, and `GROUP_HAS_ACTIVE_CHILDREN` (see their respective
endpoints below) are documented in some internal/backend contexts as
including an id list alongside the error `code` — **that id list is not
actually present in the HTTP response body today.** Branch only on `code`
for these; do not write frontend code expecting an id array on any error
response.

Every endpoint-specific error `code` is listed under that endpoint's
"Possible errors" below.

## Pagination

**Community endpoints do not use the `page`/`limit`/`data`+`meta` pagination
convention** described in `docs/api-conventions.md` for the general API.
Concretely:

- Every plain list endpoint in this module (`GET /groups`,
  `GET /groups/:id/members`, `GET /groups/:id/children`,
  `GET /groups/:groupId/role-assignments`,
  `GET /groups/:groupId/invitations`, `GET /groups/:groupId/join-requests`,
  `GET /invitations`) returns a **plain JSON array**, unbounded, with no
  paging controls at all. There is no `page`/`limit` query parameter to
  send, and none would be read if you sent one.
- `GET /discovery/groups` returns a plain array capped at a **hard limit of
  50 results**, with no way to fetch further results (no `offset`, no
  cursor, no `page` param). If more than 50 Groups match, the rest are
  simply not returned.
- `GET /community/home` uses its own, different, dashboard-specific shape
  for two of its sections (`pendingInvitations`, `pendingJoinRequests`):
  `{ "items": [...], "total": number, "hasMore": boolean }`, capped at 20
  items each. See [Community Home](#community-home).

## Filtering

The only filterable endpoint in this module is `GET /discovery/groups`,
which accepts an optional `q` query parameter: a case-insensitive,
partial, substring match against `Group.name` only. There is no filtering
by city, country, instructor, organization, or visibility on any endpoint
today.

## Sorting

No endpoint in this module accepts a client-supplied `sort` parameter.
Every list has a fixed, server-side order:

| Endpoint | Order |
|---|---|
| `GET /groups` | Most recently joined Organization first (`joinedAt` desc) |
| `GET /groups/:id/members` | Earliest-joined member first (`joinedAt` asc) |
| `GET /groups/:groupId/role-assignments` | Earliest-granted first (`grantedAt` asc) |
| `GET /discovery/groups` | Alphabetical by name (`name` asc) |
| `GET /groups/:id/children`, `GET /groups/:groupId/invitations`, `GET /groups/:groupId/join-requests`, `GET /invitations` | No explicit `orderBy` — returned in whatever order the database happens to produce (do not rely on this being stable) |

## Identifiers

- Every entity id (`id`, `groupId`, `membershipId`, `roleAssignmentId`,
  request ids, user ids) is a UUID string.
- `publicCode` (on `Group` and on `User`) is a separate, human-readable
  identifier in `XXXX-XXXX` format, 8 symbols from a Crockford-style Base32
  alphabet (digits 0-9 plus uppercase letters, excluding `I`, `L`, `O`, `U`
  to avoid visual confusion). It is generated once at creation, globally
  unique across both Groups and Users, and **never changes**. It is
  **not a secret or access token** — `GET /discovery/resolve/:code` resolves
  it for anyone, including for `isHidden: true` Groups.

## Permission rules

Permissions in this module are **never global** and are **never** resolved
from the caller's site-wide role (that's a separate, unrelated system used
only by the Music module). Every permission check is:

1. Resolved against exactly **one Group** (never "the organization in
   general") — the Group named by the request's `:id`/`:groupId` path
   param.
2. Based on the union of every `GroupRole` the caller's `Membership` holds,
   via `RoleAssignment`, **directly for that exact Group** — never inherited
   from a parent Group, a child Group, or a sibling Group.
3. Gated by the caller's Membership status: `ACTIVE` grants the full set of
   permissions for the roles held; `READ_ONLY` grants only a small
   view-only subset (see table below); `INVITED` or `ARCHIVED` grants
   nothing at all.

A caller with **no** Membership in the relevant Organization, or a
Membership but **no** `RoleAssignment` at all for the exact Group being
acted on, gets `404 Not Found` (`GROUP_NOT_FOUND`) — **never** `403`. This
is deliberate: the backend never confirms a Group's existence to someone
who isn't a member of it. `403 Forbidden` (`INSUFFICIENT_GROUP_PERMISSIONS`)
is reserved for a caller who *does* have a Role Assignment for the Group,
but whose role(s) don't include the required permission.

### Role → Permission reference

A Membership may hold **several roles at once** for the same Group (e.g.
`MEMBER` + `INSTRUCTOR` + `ADMIN` simultaneously) — effective permissions
are the union across all of them, never just one. This table is provided
for reference; **the frontend must never compute this table itself** — see
[Capability Flags](#capability-flags) and [Frontend Notes](#frontend-notes).

| Permission | MEMBER | ASSISTANT | INSTRUCTOR | ADMIN | OWNER |
|---|---|---|---|---|---|
| `GROUP_VIEW` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `MEMBERSHIP_VIEW` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ACADEMY_VIEW` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SECTION_VIEW` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GROUP_INVITE`¹ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GROUP_EDIT` | | | | ✓ | ✓ |
| `GROUP_SETTINGS_MANAGE` | | | | ✓ | ✓ |
| `AUDIT_LOG_VIEW`³ | | | | ✓ | ✓ |
| `MEMBERSHIP_ADD` | | | | ✓ | ✓ |
| `MEMBERSHIP_ROLE_CHANGE` | | | | ✓ | ✓ |
| `MEMBERSHIP_REMOVE` | | | | ✓ | ✓ |
| `MEMBERSHIP_BAN` / `MEMBERSHIP_UNBAN` | | | | ✓ | ✓ |
| `MEMBERSHIP_SUSPEND` / `MEMBERSHIP_UNSUSPEND` | | | | ✓ | ✓ |
| `MEMBERSHIP_SECTION_ASSIGN` | | | | ✓ | ✓ |
| `MEMBERSHIP_INVITE` | | | | ✓ | ✓ |
| `MEMBERSHIP_REQUEST_REVIEW`² | | | | ✓ | ✓ |
| `GROUP_JOIN_REQUEST_REVIEW` | | | | ✓ | ✓ |
| `ACADEMY_CREATE` / `ACADEMY_EDIT` / `ACADEMY_ARCHIVE` | | | | ✓ | ✓ |
| `SECTION_CREATE` / `SECTION_EDIT` / `SECTION_ARCHIVE` | | | | ✓ | ✓ |
| `GROUP_ARCHIVE` / `GROUP_UNARCHIVE` | | | | | ✓ |
| `GROUP_SET_READ_ONLY` / `GROUP_ACTIVATE` | | | | | ✓ |
| `GROUP_DELETE`⁴ | | | | | ✓ |
| `GROUP_OWNERSHIP_TRANSFER` | | | | | ✓ |

¹ `GROUP_INVITE` is granted to every role in the table, **but** the service
layer additionally requires `Group.memberInvitesAllowed === true` for a
caller whose only roles are `MEMBER`/`ASSISTANT`/`INSTRUCTOR`; `ADMIN` and
`OWNER` may always invite regardless of that setting. This extra rule is
not expressible in the guard/table above.

² `MEMBERSHIP_REQUEST_REVIEW` is defined in the permission enum and granted
to `ADMIN`/`OWNER`, but **no current endpoint checks it** — the actual
join-request-review endpoints check `GROUP_JOIN_REQUEST_REVIEW` instead
(same tier, same roles, functionally equivalent today).

`INSTRUCTOR` and `ASSISTANT` currently grant exactly the same permissions as
`MEMBER` — no additional capability exists for them yet.

³ `AUDIT_LOG_VIEW` is additionally one of the few permissions that remains
granted while the caller's Membership is `READ_ONLY` — see
[READ_ONLY membership](#read_only-membership) below.

⁴ `GROUP_DELETE` is permanent, irreversible deletion (see
[Domain Models → Group status](#group) and `docs/decisions/ADR-029-community-deletion.md`)
— deliberately not reused from `GROUP_ARCHIVE`, since it is a strictly more
severe, non-undoable action.

### READ_ONLY membership

If the caller's Membership status is `READ_ONLY`, only this subset of
permissions is ever granted, regardless of role: `GROUP_VIEW`,
`MEMBERSHIP_VIEW`, `ACADEMY_VIEW`, `SECTION_VIEW`, `AUDIT_LOG_VIEW`.
Everything else is denied, even for an `OWNER`. This is also the status a
Membership itself is placed into by [Suspend Member](#suspend-member) — a
suspended member keeps exactly this same read-only subset for every Group
they hold a Role in, nothing extra.

### Group lifecycle status also gates writes

Independently of permissions, every write endpoint additionally checks the
target Group's own `status` (`ACTIVE` / `READ_ONLY` / `ARCHIVED` /
`DELETED`). Unless an endpoint's table entry below says otherwise, it
requires `status: ACTIVE` and returns `409 Conflict` otherwise
(`GROUP_READ_ONLY`, `GROUP_ARCHIVED`, or `GROUP_DELETED`). Read endpoints
work in any status, including `DELETED` (historical data remains visible —
ADR-007). `DELETED` is a **terminal** status: unlike `ARCHIVED`, there is no
operation that moves a Group back out of it — see
[Delete Community](#delete-community).

## Where capability flags come from

See the dedicated [Capability Flags](#capability-flags) section below.

---

# Endpoints

## Groups

### 1. Create Community

**HTTP Method:** `POST`
**URL:** `/groups`

**Description:** Creates either an Organization (Root Group) or a Group
(Child Group) — the same endpoint handles both. Omitting `parentGroupId`
(or sending `null`) creates a Root Group; the caller becomes its `OWNER`
(and `MEMBER`) immediately, with a new Membership created for them.
Providing `parentGroupId` creates a Child Group under that parent; the
caller must already hold an active Membership in the parent's Organization
**and** the `GROUP_EDIT` permission directly on the parent Group — no new
Membership is created, the caller's existing Membership simply receives
`MEMBER` + `OWNER` for the new Child Group.

**Required authorization:** Signed-in user. No group-scoped permission is
required to create a Root Group — **any signed-in user may create an
Organization.**

**Required permissions:** None for a Root Group. `GROUP_EDIT` on the parent
Group when `parentGroupId` is provided.

**Request**

Body (JSON):

| Field | Type | Required | Description |
|---|---|---|---|
| `parentGroupId` | UUID or `null` | No (default `null`) | Omit/`null` → creates an Organization. A valid Group id → creates a Child Group under it. |
| `name` | string (1-150 chars, trimmed) | Yes | Display name. |
| `description` | string (≤5000 chars) or `null` | No (default `null`) | Free text. Empty/whitespace-only normalizes to `null`. |
| `logoUrl` | URL string (≤2048 chars) or `null` | No | Must be a valid URL if present. |
| `coverImageUrl` | URL string (≤2048 chars) or `null` | No | Must be a valid URL if present. |
| `contactEmail` | email string (≤255 chars) or `null` | No | |
| `contactPhone` | string (≤50 chars) or `null` | No | |
| `websiteUrl` | URL string (≤2048 chars) or `null` | No | |
| `facebookUrl` | URL string (≤2048 chars) or `null` | No | |
| `instagramUrl` | URL string (≤2048 chars) or `null` | No | |
| `youtubeUrl` | URL string (≤2048 chars) or `null` | No | |
| `isPublic` | boolean | No (default `true`) | `true` = anyone can join instantly; `false` = joining creates a Join Request that needs approval. |
| `isHidden` | boolean | No (default `false`) | `true` = excluded from `GET /discovery/groups`; still joinable via `publicCode`/link. |
| `memberInvitesAllowed` | boolean | No (default `false`) | Whether a plain `MEMBER` (not `ADMIN`/`OWNER`) may send Invitations. |
| `timezone` | string | Yes | Must be a valid IANA timezone id (e.g. `"Europe/Warsaw"`), validated against the runtime's own IANA database. |
| `currencyCode` | string | Yes | Normalized to uppercase; must match `^[A-Z]{3}$` (structural check only — not validated against an actual ISO 4217 list). |
| `country` | ISO 3166-1 alpha-2 string | Yes | Required on both an Organization and a Group — no exception for an Organization spanning multiple countries. |
| `city` | string (1-100 chars, trimmed) | Yes | Must be a real city of `country` — see [Search Cities](#35b-search-cities), which returns exactly the values accepted here. |

**Response** — `201 Created`, body: [`GroupResponseDto`](#groupresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body fails schema validation (see table above) — including `city` missing/empty, or not a real city of `country`. |
| 404 | `GROUP_PARENT_NOT_FOUND` | `parentGroupId` doesn't resolve to a Group the caller has any usable authorization for (also returned if the parent simply doesn't exist — the two cases are indistinguishable by design). |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller has a Role Assignment for the parent Group, but it doesn't include `GROUP_EDIT`. |
| 409 | `GROUP_ARCHIVED` | The named parent Group is archived. |

Editing (`PATCH /groups/:id`) is a full-replace of the same shape (see
[Update Community](#4-update-community)), so `country`/`city` are equally
required there — an edit can never clear them, and is subject to the same
country/city match check.

---

### 2. List My Communities (Organizations)

**HTTP Method:** `GET`
**URL:** `/groups`

**Description:** Lists every **Organization** (Root Group) the caller has
an `ACTIVE` Membership in. **This does not include Child Groups** the
caller participates in — only Organizations. (Contrast with
`GET /community/home`'s `myCommunities`, which does include Child Groups —
see [Community Home](#community-home).)

**Required authorization:** Signed-in user.

**Required permissions:** None (scoped to the caller by construction).

**Request:** No path, query, or body parameters.

**Response** — `200 OK`, body: array of [`GroupSummaryResponseDto`](#groupsummaryresponsedto).

**Possible errors:** None beyond the global 401.

---

### 3. Get Community

**HTTP Method:** `GET`
**URL:** `/groups/:id`

**Description:** Fetches a single Group (Organization or Child Group) by
id. Works regardless of the Group's lifecycle status.

**Required authorization:** Signed-in user with a usable Role Assignment
for this exact Group.

**Required permissions:** `GROUP_VIEW`.

**Request**

Path:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | Yes | The Group's id. |

**Response** — `200 OK`, body: [`GroupResponseDto`](#groupresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | Group doesn't exist, or caller has no Role Assignment for it. |

---

### 4. Update Community

**HTTP Method:** `PATCH`
**URL:** `/groups/:id`

**Description:** Full-replace update of every editable field (there is no
partial-patch semantics — every field in the schema must be supplied, using
the same shape as Create). `status` and `parentGroupId` cannot be changed
through this endpoint — `parentGroupId` is rejected outright (schema uses
`.strict()` and omits it), not merely ignored.

**Required authorization:** Signed-in user with a Role Assignment granting
`GROUP_EDIT` for this exact Group.

**Required permissions:** `GROUP_EDIT`. Requires the Group's status to be
`ACTIVE` (default gate — no override).

**Request**

Path: `id` (UUID, required).

Body: identical fields to [Create Community](#1-create-community) **except**
`parentGroupId` is not accepted at all (submitting it returns `400
VALIDATION_ERROR`, "unrecognized key").

**Response** — `200 OK`, body: [`GroupResponseDto`](#groupresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body, or `parentGroupId` present. |
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for this Group. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Role(s) held don't include `GROUP_EDIT`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 5. Archive Community

**HTTP Method:** `POST`
**URL:** `/groups/:id/archive`

**Description:** Moves the Group to `ARCHIVED` status. Valid from `ACTIVE`
or `READ_ONLY`. No Membership or Role Assignment is touched by this call.

**Required authorization:** Role Assignment granting `GROUP_ARCHIVE`
(`OWNER` only).

**Required permissions:** `GROUP_ARCHIVE`. Allowed source statuses:
`ACTIVE`, `READ_ONLY`.

**Request:** Path `id` (UUID). No body.

**Response** — **`201 Created`** (not 200 — this endpoint has no
`@HttpCode` override, so it returns NestJS's default status for `POST`;
see [Frontend Notes](#frontend-notes)). Body: [`GroupResponseDto`](#groupresponsedto)
with `status: "ARCHIVED"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Not an `OWNER`. |
| 409 | `GROUP_ARCHIVED` | Already archived. |

---

### 6. Unarchive Community

**HTTP Method:** `POST`
**URL:** `/groups/:id/unarchive`

**Description:** Moves an `ARCHIVED` Group back to `ACTIVE`. This is the
**only** path back from `ARCHIVED` — there is no `ARCHIVED → READ_ONLY`
transition.

**Required authorization:** Role Assignment granting `GROUP_UNARCHIVE`
(`OWNER` only).

**Required permissions:** `GROUP_UNARCHIVE`. Allowed source status:
`ARCHIVED` only.

**Request:** Path `id` (UUID). No body.

**Response** — **`201 Created`** (see note under endpoint 5). Body:
[`GroupResponseDto`](#groupresponsedto) with `status: "ACTIVE"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Not an `OWNER`. |
| 409 | `GROUP_ACTIVE` / `GROUP_READ_ONLY` | Group isn't currently `ARCHIVED`. |

---

### 7. Set Community Read-Only

**HTTP Method:** `POST`
**URL:** `/groups/:id/read-only`

**Description:** Moves an `ACTIVE` Group to `READ_ONLY`. `READ_ONLY` means
the Group and its data remain fully readable, but almost every write is
blocked until it's reactivated.

**Required authorization:** Role Assignment granting `GROUP_SET_READ_ONLY`
(`OWNER` only).

**Required permissions:** `GROUP_SET_READ_ONLY`. Allowed source status:
`ACTIVE` only.

**Request:** Path `id` (UUID). No body.

**Response** — **`201 Created`** (see note under endpoint 5). Body:
[`GroupResponseDto`](#groupresponsedto) with `status: "READ_ONLY"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Not an `OWNER`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't currently `ACTIVE`. |

---

### 8. Reactivate Community

**HTTP Method:** `POST`
**URL:** `/groups/:id/activate`

**Description:** Moves a `READ_ONLY` Group back to `ACTIVE`. This endpoint
**cannot** be used from `ARCHIVED` — use Unarchive instead.

**Required authorization:** Role Assignment granting `GROUP_ACTIVATE`
(`OWNER` only).

**Required permissions:** `GROUP_ACTIVATE`. Allowed source status:
`READ_ONLY` only.

**Request:** Path `id` (UUID). No body.

**Response** — **`201 Created`** (see note under endpoint 5). Body:
[`GroupResponseDto`](#groupresponsedto) with `status: "ACTIVE"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Not an `OWNER`. |
| 409 | `GROUP_ACTIVE` / `GROUP_ARCHIVED` | Group isn't currently `READ_ONLY`. |

---

### 9. List Direct Children

**HTTP Method:** `GET`
**URL:** `/groups/:id/children`

**Description:** Lists the **direct** children of this Group only (one
level — not the full descendant subtree).

**Required authorization:** Role Assignment granting `GROUP_VIEW` for
`:id`.

**Required permissions:** `GROUP_VIEW`. Works in any Group status.

**Request:** Path `id` (UUID).

**Response** — `200 OK`, body: array of [`GroupResponseDto`](#groupresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |

---

### 10. Transfer Ownership

**HTTP Method:** `POST`
**URL:** `/groups/:id/transfer-ownership`

**Description:** Atomically moves the `OWNER` role from the caller to
another active member of the same Organization, for this exact Group
(Root or Child). The previous owner keeps every other role they hold for
this Group (e.g. `ADMIN`) — only `OWNER` moves. The new owner is
automatically granted `MEMBER` too if they didn't already hold any role for
this Group.

**Required authorization:** Role Assignment granting
`GROUP_OWNERSHIP_TRANSFER` (`OWNER` only) — i.e., only the current owner
can initiate a transfer.

**Required permissions:** `GROUP_OWNERSHIP_TRANSFER`. Requires `ACTIVE`
status (default gate).

**Request**

Path: `id` (UUID).

Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `newOwnerUserId` | UUID | Yes | Must already be an active member of the same Organization. Cannot equal the caller's own user id. |

**Response** — `201 Created` (no `@HttpCode` override on this handler).
Body: [`TransferOwnershipResponseDto`](#transferownershipresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `CANNOT_TRANSFER_TO_SELF` | `newOwnerUserId` equals the caller's own id. |
| 400 | `TARGET_NOT_A_MEMBER` | `newOwnerUserId` has no active Membership in this Organization. |
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller isn't the current `OWNER`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 11. Leave Community

**HTTP Method:** `POST`
**URL:** `/groups/:id/leave`

**Description:** Self-service: archives the caller's own Membership in the
Organization this Group belongs to (`endReason: "LEFT"`). Blocked if the
caller currently owns **any** Group in the Organization's tree (this Group
or any descendant) — ownership must be transferred first.

**Required authorization:** Role Assignment granting `GROUP_VIEW` for
`:id` (i.e., any member).

**Required permissions:** `GROUP_VIEW`. Requires `ACTIVE` status (default
gate).

**Request:** Path `id` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | Caller has no active Membership (edge case). |
| 409 | `OWNER_MUST_TRANSFER_OWNERSHIP` | Caller owns one or more Groups in this Organization (see the [Error format](#error-format) note — no id list is actually present in the response). |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

## Memberships

### 12. List Members

**HTTP Method:** `GET`
**URL:** `/groups/:id/members`

**Description:** Lists every **currently active** member of the
Organization identified by `:id` (which must be a Root Group — this list is
always Organization-wide, not Child-Group-scoped).

**Required authorization:** Role Assignment granting `GROUP_VIEW` for
`:id`.

**Required permissions:** `GROUP_VIEW`. Works in any Group status.

**Request:** Path `id` (UUID).

**Response** — `200 OK`, body: array of [`GroupMembershipResponseDto`](#groupmembershipresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |

---

### 13. Add Member

**HTTP Method:** `POST`
**URL:** `/groups/:id/members`

**Description:** "Technical" add — directly creates an `ACTIVE` Membership
for an existing user, with **no invitation/acceptance step**. `:id` must be
a Root Group. Optionally also grants one role for the Root Group itself in
the same call.

**Required authorization:** Role Assignment granting `MEMBERSHIP_ADD`
(`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_ADD`. Requires `ACTIVE` status
(default gate).

**Request**

Path: `id` (UUID) — must be a Root Group.

Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | UUID | Yes | Must reference an existing user. |
| `role` | one of `"ADMIN"`, `"INSTRUCTOR"`, `"ASSISTANT"`, `"MEMBER"` | No | `OWNER` cannot be granted here. Omitting it creates the Membership with **no** role at all (a valid state — the user belongs to the Organization but participates in no specific Group yet). |

**Response** — `201 Created`, body: [`GroupMembershipResponseDto`](#groupmembershipresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body. |
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 400 | `MEMBERSHIP_ROOT_GROUP_MISMATCH` | `:id` is a Child Group, not a Root Group. |
| 400 | `USER_NOT_FOUND` | `userId` doesn't exist. |
| 409 | `ALREADY_A_MEMBER` | Target already has an active Membership in this Organization. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_ADD`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 14. Get Membership

**HTTP Method:** `GET`
**URL:** `/groups/:id/members/:membershipId`

**Description:** Fetches a single Membership by id, **including** ones
that have already ended (`ARCHIVED`) — this endpoint is the way to view
membership history, not just current members.

**Required authorization:** Role Assignment granting `GROUP_VIEW` for
`:id`.

**Required permissions:** `GROUP_VIEW`. Works in any Group status.

**Request**

Path: `id` (Organization UUID), `membershipId` (UUID).

**Response** — `200 OK`, body: [`GroupMembershipResponseDto`](#groupmembershipresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | `membershipId` doesn't exist under this Organization. |

---

### 15. Remove Member

**HTTP Method:** `DELETE`
**URL:** `/groups/:id/members/:membershipId`

**Description:** Administrator-initiated removal — archives the target's
Membership (`endReason: "REMOVED"`). Blocked if the target currently owns
any Group in the Organization's tree.

**Note:** there is **no** endpoint to change a member's role directly (no
`PATCH` here). Granting/revoking a specific role always goes through
[Role Assignments](#role-assignments).

**Required authorization:** Role Assignment granting `MEMBERSHIP_REMOVE`
(`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_REMOVE`. Requires `ACTIVE` status
(default gate).

**Request:** Path `id` (UUID), `membershipId` (UUID).

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | Target Membership doesn't exist or is already archived. |
| 409 | `CANNOT_REMOVE_OWNER` | Target owns one or more Groups (see the [Error format](#error-format) note — no id list is actually present in the response). |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_REMOVE`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 16. Assign Member to Section

**HTTP Method:** `POST`
**URL:** `/groups/:id/members/:membershipId/sections/:sectionId`

**Description:** Assigns an active Membership to a Section (see
[Domain Models](#domain-models) — Section itself is not otherwise part of
this document's scope). The Section must belong to the same Organization
as the Membership and must not be archived.

**Required authorization:** Role Assignment granting
`MEMBERSHIP_SECTION_ASSIGN` (`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_SECTION_ASSIGN`. Requires `ACTIVE`
status (default gate).

**Request:** Path `id` (Organization UUID), `membershipId` (UUID),
`sectionId` (UUID). No body.

**Response** — `201 Created`, empty body.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | `membershipId` doesn't exist. |
| 409 | `MEMBERSHIP_NOT_ACTIVE` | Target Membership isn't `ACTIVE`. |
| 404 | `SECTION_NOT_FOUND` | `sectionId` doesn't exist. |
| 409 | `MEMBERSHIP_SECTION_ARCHIVED` | Section is archived. |
| 400 | `MEMBERSHIP_SECTION_MISMATCH` | Section belongs to a different Organization. |
| 409 | `MEMBERSHIP_SECTION_ALREADY_ASSIGNED` | Already assigned. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks the permission. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 17. Unassign Member from Section

**HTTP Method:** `DELETE`
**URL:** `/groups/:id/members/:membershipId/sections/:sectionId`

**Description:** Removes a Section assignment.

**Required authorization:** Role Assignment granting
`MEMBERSHIP_SECTION_ASSIGN` (`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_SECTION_ASSIGN`. Requires `ACTIVE`
status (default gate).

**Request:** Path `id`, `membershipId`, `sectionId` (all UUID). No body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | `membershipId` doesn't exist. |
| 404 | `MEMBERSHIP_SECTION_ASSIGNMENT_NOT_FOUND` | Not currently assigned to this Section. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks the permission. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

## Role Assignments

All four endpoints below are nested under `/groups/:groupId/role-assignments`
and act on the exact Group named by `:groupId` (Root or Child). There is
deliberately **no `PATCH`**: a Membership can hold several independent roles
for the same Group at once, so there is no single role to "change" — only
grant (`POST`) and revoke (`DELETE`).

### 18. Grant Role Assignment

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/role-assignments`

**Description:** Grants one role to an existing Membership for this exact
Group. The target Membership must already be `ACTIVE` in this Group's
Organization. If this is the Membership's first role for this Group, `MEMBER`
is granted automatically alongside the requested role (unless the requested
role is itself `MEMBER`). Granting a role never replaces another role the
Membership already holds for this Group — they simply coexist.

**Required authorization:** Role Assignment granting
`MEMBERSHIP_ROLE_CHANGE` (`ADMIN`/`OWNER`) for `:groupId`.

**Required permissions:** `MEMBERSHIP_ROLE_CHANGE`. Requires `ACTIVE`
status (default gate).

**Request**

Path: `groupId` (UUID).

Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `membershipId` | UUID | Yes | The target's existing Membership id (found via `GET /groups/:id/members`) — **not** a user id. |
| `role` | one of `"ADMIN"`, `"INSTRUCTOR"`, `"ASSISTANT"`, `"MEMBER"` | Yes | `OWNER` cannot be granted here — see [Transfer Ownership](#10-transfer-ownership). |

**Response** — `201 Created`, body: [`RoleAssignmentResponseDto`](#roleassignmentresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body. |
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId` (guard), or target group not found (service). |
| 404 | `MEMBERSHIP_NOT_FOUND` | `membershipId` doesn't exist. |
| 409 | `ROLE_ROOT_GROUP_MISMATCH` | The Membership doesn't belong to this Group's Organization. |
| 409 | `ROLE_MEMBERSHIP_NOT_ACTIVE` | Target Membership isn't `ACTIVE`. |
| 409 | `ROLE_ASSIGNMENT_ALREADY_EXISTS` | This exact (membership, group, role) already exists. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_ROLE_CHANGE`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 19. List Role Assignments

**HTTP Method:** `GET`
**URL:** `/groups/:groupId/role-assignments`

**Description:** Lists every Role Assignment for this exact Group, across
every Membership.

**Required authorization:** Role Assignment granting `MEMBERSHIP_VIEW`.

**Required permissions:** `MEMBERSHIP_VIEW`. No `@AllowGroupStatuses`
override on this handler → requires `ACTIVE` status.

**Request:** Path `groupId` (UUID).

**Response** — `200 OK`, body: array of [`RoleAssignmentResponseDto`](#roleassignmentresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE` (note: this blocks even reading the list — see [Frontend Notes](#frontend-notes)). |

---

### 20. Get Role Assignment

**HTTP Method:** `GET`
**URL:** `/groups/:groupId/role-assignments/:roleAssignmentId`

**Description:** Fetches a single Role Assignment.

**Required authorization:** Role Assignment granting `MEMBERSHIP_VIEW`.

**Required permissions:** `MEMBERSHIP_VIEW`. Requires `ACTIVE` status
(default gate — same caveat as endpoint 19).

**Request:** Path `groupId` (UUID), `roleAssignmentId` (UUID).

**Response** — `200 OK`, body: [`RoleAssignmentResponseDto`](#roleassignmentresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 404 | `ROLE_ASSIGNMENT_NOT_FOUND` | `roleAssignmentId` doesn't exist under this Group. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 21. Revoke Role Assignment

**HTTP Method:** `DELETE`
**URL:** `/groups/:groupId/role-assignments/:roleAssignmentId`

**Description:** Revokes a single role. Two protections apply:

- `OWNER` can **never** be revoked here — only via
  [Transfer Ownership](#10-transfer-ownership).
- `MEMBER` cannot be revoked while the same Membership still holds **any
  other** role for this Group. Once it's the last remaining role, revoking
  it removes the user from this Child Group entirely — **except** for a
  Group's own Root Group, where `MEMBER` can never be revoked through this
  endpoint at all (use [Leave](#11-leave-community) or
  [Remove Member](#15-remove-member) instead).

**Required authorization:** Role Assignment granting
`MEMBERSHIP_ROLE_CHANGE`.

**Required permissions:** `MEMBERSHIP_ROLE_CHANGE`. Requires `ACTIVE`
status (default gate).

**Request:** Path `groupId` (UUID), `roleAssignmentId` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 404 | `ROLE_ASSIGNMENT_NOT_FOUND` | Doesn't exist. |
| 409 | `CANNOT_REMOVE_OWNER` | Target role is `OWNER`. |
| 409 | `CANNOT_REMOVE_ROOT_MEMBER_ROLE` | Target role is `MEMBER` on the Membership's own Root Group. |
| 409 | `CANNOT_REMOVE_MEMBER_ROLE` | Target role is `MEMBER` for a Child Group, and other roles still exist there. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_ROLE_CHANGE`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

## Join & Join Requests

### 22. Join Community

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/join`

**Description:** The "Join" button. If the target Group's `isPublic` is
`true`, joining is immediate. If `false`, this creates a pending Join
Request instead (a `MembershipRequest` row with `type: "JOIN_REQUEST"`).
`isHidden` has **no effect** on this endpoint — a hidden Group is still
fully joinable, it's just excluded from search.

**Required authorization:** Any signed-in user. **No group-scoped
permission is required** — this is the one write endpoint under
`/groups/:groupId` with no `@RequireGroupPermission`, since by definition
the caller may not be a member yet.

**Required permissions:** None.

**Request**

Path: `groupId` (UUID).

Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `targetType` | `"ORGANIZATION"` or `"GROUP"` | Yes, no default | The backend never infers intent. `"ORGANIZATION"` requires `groupId` to be a Root Group. `"GROUP"` accepts a Root or Child Group and, on acceptance, additionally grants `MEMBER` for that exact Group (in addition to Organization-level Membership). |

**Response** — `200 OK`. Body is **one of two different shapes**,
depending on `isPublic`:

- If joined immediately: `{ "joined": true }`.
- If a Join Request was created: [`MembershipRequestResponseDto`](#membershiprequestresponsedto)
  with `status: "PENDING"`, `type: "JOIN_REQUEST"`.

Frontend must branch on the presence of a `joined` field to tell these
apart.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `targetType` missing or not one of the two valid values. |
| 404 | `GROUP_NOT_FOUND` | Group doesn't exist. |
| 409 | `GROUP_ARCHIVED` | Group is archived. |
| 422 | `NOT_A_ROOT_GROUP` | `targetType: "ORGANIZATION"` but `groupId` is a Child Group. |
| 409 | `ALREADY_MEMBER` | Caller already has an active Membership in this Organization (`targetType: "ORGANIZATION"`). |
| 409 | `ALREADY_GROUP_MEMBER` | Caller already holds `MEMBER` for this exact Group (`targetType: "GROUP"`). |
| 409 | `JOIN_REQUEST_ALREADY_PENDING` | Caller already has a pending Join Request for this Group. |

---

### 23. Withdraw My Join Request

**HTTP Method:** `DELETE`
**URL:** `/groups/:groupId/join-requests/mine`

**Description:** Cancels the caller's own pending Join Request for this
Group (`status → "CANCELLED"`).

**Required authorization:** Any signed-in user. No group-scoped permission
required.

**Required permissions:** None.

**Request:** Path `groupId` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `JOIN_REQUEST_NOT_FOUND` | No pending Join Request from this caller for this Group. |

---

### 24. List Join Requests (admin view)

**HTTP Method:** `GET`
**URL:** `/groups/:groupId/join-requests`

**Description:** Lists every pending Join Request targeting this Group.

**Required authorization:** Role Assignment granting
`GROUP_JOIN_REQUEST_REVIEW` (`ADMIN`/`OWNER`).

**Required permissions:** `GROUP_JOIN_REQUEST_REVIEW`. Works in any Group
status.

**Request:** Path `groupId` (UUID).

**Response** — `200 OK`, body: array of [`MembershipRequestResponseDto`](#membershiprequestresponsedto)
(all with `type: "JOIN_REQUEST"`, `status: "PENDING"`).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `GROUP_JOIN_REQUEST_REVIEW`. |

---

### 25. Approve Join Request

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/join-requests/:requestId/approve`

**Description:** Approves a pending Join Request — creates/reactivates the
requester's Membership (and, for `targetType: "GROUP"`, grants `MEMBER` on
the exact target Group).

**Required authorization:** Role Assignment granting
`GROUP_JOIN_REQUEST_REVIEW`. **Note:** no `@AllowGroupStatuses` override →
requires the Group's own status to be `ACTIVE` (unlike the list endpoint
above, which works in any status).

**Required permissions:** `GROUP_JOIN_REQUEST_REVIEW`. Requires `ACTIVE`
status.

**Request:** Path `groupId` (UUID), `requestId` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 404 | `MEMBERSHIP_REQUEST_NOT_FOUND` | `requestId` doesn't exist. |
| 422 | `NOT_A_JOIN_REQUEST` | The request is an Invitation, not a Join Request. |
| 409 | `REQUEST_NOT_PENDING` | Already processed. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks the permission. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 26. Reject Join Request

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/join-requests/:requestId/reject`

**Description:** Rejects a pending Join Request. No Membership or role is
created.

**Required authorization:** Role Assignment granting
`GROUP_JOIN_REQUEST_REVIEW`. No `@AllowGroupStatuses` override → requires
`ACTIVE`.

**Required permissions:** `GROUP_JOIN_REQUEST_REVIEW`. Requires `ACTIVE`
status.

**Request:** Path `groupId` (UUID), `requestId` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors:** Same table as [Approve Join Request](#25-approve-join-request).

---

## Invitations (group-scoped / admin view)

### 27. Create Invitation

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/invitations`

**Description:** Invites a specific user (by id or email) to this Group.
Exactly one of `invitedUserId`/`invitedEmail` must be given. If
`invitedEmail` matches an existing account, the backend silently treats it
as a user-based invitation instead.

**Required authorization:** Role Assignment granting `GROUP_INVITE`
(granted to every role, see caveat below).

**Required permissions:** `GROUP_INVITE`. Additionally, if the caller's
roles for this Group are only `MEMBER`/`ASSISTANT`/`INSTRUCTOR` (no
`ADMIN`/`OWNER`), the target Group's `memberInvitesAllowed` must be `true`
— this extra check is enforced in the service layer, not by the guard, and
returns its own error code (see below). `ADMIN`/`OWNER` bypass this
setting entirely. Requires `ACTIVE` status (default gate).

**Request**

Path: `groupId` (UUID).

Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `targetType` | `"ORGANIZATION"` or `"GROUP"` | Yes | `"ORGANIZATION"` requires `groupId` to be a Root Group; accepting creates Membership only. `"GROUP"` accepts any Group; accepting also grants `MEMBER` there. |
| `invitedUserId` | UUID or `null` | Exactly one of `invitedUserId`/`invitedEmail` | Invite an existing account directly. |
| `invitedEmail` | email string (≤255 chars) or `null` | Exactly one of `invitedUserId`/`invitedEmail` | Normalized to lowercase. |

**Response** — `201 Created`, body: [`MembershipRequestResponseDto`](#membershiprequestresponsedto)
with `type: "INVITATION"`, `status: "PENDING"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body. |
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 422 | `NOT_A_ROOT_GROUP` | `targetType: "ORGANIZATION"` but `groupId` is a Child Group. |
| 403 | `MEMBER_INVITES_NOT_ALLOWED` | Caller is only `MEMBER`/`ASSISTANT`/`INSTRUCTOR` and `Group.memberInvitesAllowed` is `false`. |
| 403 | `MEMBERSHIP_NOT_ACTIVE` | Caller's own Membership isn't `ACTIVE` (reached only via the `memberInvitesAllowed` code path). |
| 422 | `INVITATION_RECIPIENT_REQUIRED` | Neither `invitedUserId` nor `invitedEmail` given. |
| 422 | `INVITATION_RECIPIENT_AMBIGUOUS` | Both given. |
| 404 | `INVITED_USER_NOT_FOUND` | `invitedUserId` doesn't exist. |
| 409 | `ALREADY_MEMBER` / `ALREADY_GROUP_MEMBER` | The invitee already belongs (see [Join Community](#22-join-community) codes — same meaning here). |
| 409 | `INVITATION_ALREADY_PENDING` | A pending invitation for this recipient + Group already exists. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `GROUP_INVITE` entirely. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

### 28. List Invitations for Group (admin view)

**HTTP Method:** `GET`
**URL:** `/groups/:groupId/invitations`

**Description:** Lists every pending Invitation sent for this Group (the
management view — contrast with [`GET /invitations`](#31-list-my-received-invitations),
which is the recipient's view).

**Required authorization:** Role Assignment granting `MEMBERSHIP_VIEW`.

**Required permissions:** `MEMBERSHIP_VIEW`. Works in any Group status.

**Request:** Path `groupId` (UUID).

**Response** — `200 OK`, body: array of [`MembershipRequestResponseDto`](#membershiprequestresponsedto)
(`type: "INVITATION"`, `status: "PENDING"`).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |

---

### 29. Cancel Invitation

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/invitations/:invitationId/cancel`

**Description:** Cancels a pending Invitation. **Only** the original
inviter, or an `ADMIN`/`OWNER` of the target Group, may cancel — a plain
`MEMBER` who did not create the invitation is rejected even if
`memberInvitesAllowed` is `true`. The guard's declared permission
(`MEMBERSHIP_VIEW`) is deliberately the lowest tier so every role reaches
the service, which then applies this finer rule itself.

**Required authorization:** Role Assignment granting `MEMBERSHIP_VIEW`
(i.e., any member) — the real authorization check happens in the service.

**Required permissions:** `MEMBERSHIP_VIEW` (guard-level only — see above).
Works in any Group status.

**Request:** Path `groupId` (UUID), `invitationId` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 404 | `MEMBERSHIP_REQUEST_NOT_FOUND` | `invitationId` doesn't exist. |
| 422 | `NOT_AN_INVITATION` | The request is a Join Request, not an Invitation. |
| 409 | `REQUEST_NOT_PENDING` | Already processed. |
| 403 | `INSUFFICIENT_PERMISSIONS_TO_CANCEL_INVITATION` | Caller is neither the original inviter nor an `ADMIN`/`OWNER`. |

---

### 30. Resend Invitation

**HTTP Method:** `POST`
**URL:** `/groups/:groupId/invitations/:invitationId/resend`

**Description:** Cancels the existing pending Invitation and creates a
fresh one with the same recipient/target — effectively a "re-send" that
gets a new id and `createdAt`.

**Required authorization:** Role Assignment granting `GROUP_INVITE`.

**Required permissions:** `GROUP_INVITE`. Requires `ACTIVE` status
(default gate).

**Request:** Path `groupId` (UUID), `invitationId` (UUID). No body.

**Response** — `201 Created`, body: the **new**
[`MembershipRequestResponseDto`](#membershiprequestresponsedto) (different
`id` from the one passed in).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 404 | `MEMBERSHIP_REQUEST_NOT_FOUND` | `invitationId` doesn't exist. |
| 422 | `NOT_AN_INVITATION` | The request is a Join Request. |
| 409 | `REQUEST_NOT_PENDING` | Already processed. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `GROUP_INVITE`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` | Group isn't `ACTIVE`. |

---

## Invitations (user-centric)

These three endpoints are **not** nested under `/groups/:groupId` and carry
**no group-permission guard at all** — they operate purely on "invitations
addressed to me," scoped entirely by the caller's own identity.

### 31. List My Received Invitations

**HTTP Method:** `GET`
**URL:** `/invitations`

**Description:** Lists every pending Invitation addressed to the caller
(matched by their user id or their account email).

**Required authorization:** Signed-in user.

**Required permissions:** None.

**Request:** No parameters.

**Response** — `200 OK`, body: array of [`MembershipRequestResponseDto`](#membershiprequestresponsedto)
(`type: "INVITATION"`, `status: "PENDING"`).

**Possible errors:** None beyond the global 401.

---

### 32. Accept Invitation

**HTTP Method:** `POST`
**URL:** `/invitations/:id/accept`

**Description:** Accepts an Invitation addressed to the caller. Creates
(or reactivates) the caller's Membership in the target Organization, and,
for `targetType: "GROUP"`, additionally grants `MEMBER` on the exact target
Group.

**Required authorization:** Signed-in user who is the invitation's
recipient (checked by matching `invitedUser.id` or `invitedEmail` against
the caller).

**Required permissions:** None (identity check only, done in the service).

**Request:** Path `id` (UUID — the Invitation/`MembershipRequest` id). No
body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `MEMBERSHIP_REQUEST_NOT_FOUND` | `id` doesn't exist. |
| 422 | `NOT_AN_INVITATION` | The request is a Join Request. |
| 409 | `REQUEST_NOT_PENDING` | Already processed. |
| 403 | `NOT_YOUR_INVITATION` | Caller isn't the invitee. |

---

### 33. Reject Invitation

**HTTP Method:** `POST`
**URL:** `/invitations/:id/reject`

**Description:** Rejects an Invitation addressed to the caller. No
Membership or role is created.

**Required authorization:** Signed-in user who is the invitation's
recipient.

**Required permissions:** None.

**Request:** Path `id` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors:** Same table as [Accept Invitation](#32-accept-invitation).

---

## Discovery

Both endpoints require a signed-in user (see [Authorization](#authorization))
even though conceptually they're a "public browse" surface — this is
needed to compute `isMember`/`hasPendingRequest` per result.

### 34. Resolve by Public Code

**HTTP Method:** `GET`
**URL:** `/discovery/resolve/:code`

**Description:** Resolves any Group or User by its `publicCode`
(case-insensitive). Tries `Group` first, then `User`. Works even for
`isHidden: true` Groups — the code itself is the discovery bypass.

**Required authorization:** Signed-in user.

**Required permissions:** None.

**Request:** Path `code` (string — the `XXXX-XXXX` public code; any casing
accepted).

**Response** — `200 OK`, body: [`DiscoveredResourceDto`](#discoveredresourcedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `RESOURCE_NOT_FOUND` | No Group or User has this `publicCode`. |

---

### 35. Search Groups

**HTTP Method:** `GET`
**URL:** `/discovery/groups`

**Description:** Searches Groups that are **not** hidden and currently
`ACTIVE`. Includes both Organizations and Child Groups in the results —
`resourceType` on each result tells you which. Returns at most 50 results,
ordered by name. There is **no** filter for `isPublic` — a private
(`isPublic: false`) Group still appears here as long as it isn't
`isHidden`; the client should use `group.isPublic` on each result to render
"Join" vs "Request Access."

**Required authorization:** Signed-in user.

**Required permissions:** None.

**Request**

Query:

| Field | Type | Required | Description |
|---|---|---|---|
| `q` | string | No | Case-insensitive partial match against `name`. Omit to list the first 50 visible Groups alphabetically. |

**Response** — `200 OK`, body: array (≤50) of [`DiscoveredResourceDto`](#discoveredresourcedto).

**Possible errors:** None beyond the global 401.

---

### 35b. Search Cities

**HTTP Method:** `GET`
**URL:** `/discovery/cities`

**Description:** Lists cities belonging to one country, optionally narrowed
by name — backs a "pick your city" step constrained to a previously-chosen
country on Create/Edit Community (see [Create Community](#1-create-community),
whose `city` field must be one of the names this endpoint can return). Reads
from a static, bundled geographic reference dataset
(`cities.json`/GeoNames — see the backend's `common/geo/city-directory.ts`
for the exact source and its licensing/limitations), not from
Group/Section data itself — unrelated to [Search Groups](#35-search-groups)
above, which searches communities, not raw geography.

**Known limitation — local names:** the underlying GeoNames data stores a
handful of internationally prominent cities (not only capitals — e.g. also
Naples, Florence, Milan, Antwerp) under their common English exonym rather
than the local-language name — e.g. Poland's capital is only searchable
here as `"Warsaw"`, not `"Warszawa"`, and is returned that way too. This is
a property of the underlying dataset itself, confirmed against GeoNames'
own raw data (see `city-directory.ts`'s own comment for the full
investigation) — not something this endpoint or the Group/Section
validation adds on top. Fixing it correctly (not via a hand-maintained
alias list) requires a separate data-source project — out of scope for
this pass.

**Required authorization:** Signed-in user.

**Required permissions:** None.

**Request**

Query:

| Field | Type | Required | Description |
|---|---|---|---|
| `country` | ISO 3166-1 alpha-2 string | Yes | Restricts results to this country only — there is no "browse every city" mode. |
| `search` | string (1-100 chars) | No | Case-insensitive substring match against city name. |
| `limit` | integer 1-50 | No (default 20) | |

**Response** — `200 OK`, body: array of `CityResultDto`:

| Field | Type | Description |
|---|---|---|
| `name` | string | The city's name, exactly as stored — this is also the value to submit as `city` on Create/Edit Community. |
| `country` | string | Echoes the request's `country`. |
| `region` | string or `null` | The admin1 region's English name (e.g. "Mazovia") whenever the dataset resolves one for this city — `null` only when the source itself has none for it. Always present when available, regardless of `search`/`limit`/whether another same-named city also appears in the response — a stable per-city fact, never a function of the rest of the result set. |

Sorted alphabetically by name (region as tiebreaker), capped at `limit`,
never contains a duplicate (name, region) pair.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `country` missing/invalid, or `search`/`limit` out of bounds. |

---

## Community Administration

Endpoints added for the Community administrative module: permanent
deletion, Ban/Unban, Suspend/Unsuspend, the Audit Log, and Community
Notification settings. Numbered continuing from [Discovery](#discovery)
above (36–43) rather than interleaved into the Groups/Memberships sections,
so every existing endpoint's number and anchor above is completely
unaffected by this addition.

### 36. Delete Community

**HTTP Method:** `POST`
**URL:** `/groups/:id/delete`

**Description:** Permanently and irreversibly moves the Group to
`DELETED` status (see `docs/decisions/ADR-029-community-deletion.md`) —
distinct from, and strictly more severe than, [Archive](#5-archive-community).
Like Archive, this is a **status-only** change: no Membership or Role
Assignment is touched, and every historical row referencing this Group
(Memberships, Role Assignments, Membership Requests, Audit Log entries)
remains intact and readable, per ADR-007. Unlike Archive, **there is no way
back** — no endpoint ever moves a Group out of `DELETED`.

Blocked while the Group has any Child Group that is not itself already
`ARCHIVED` or `DELETED` — a Community must not be permanently removed while
an active substructure still hangs off it with no way back.

**Required authorization:** Role Assignment granting `GROUP_DELETE`
(`OWNER` only).

**Required permissions:** `GROUP_DELETE`. Allowed source statuses:
`ACTIVE`, `READ_ONLY`, `ARCHIVED`.

**Request:** Path `id` (UUID). No body.

**Response** — `201 Created` (no `@HttpCode` override — same NestJS-default
quirk as Archive/Unarchive/Read-Only/Activate; see
[Frontend Notes](#frontend-notes)). Body:
[`GroupResponseDto`](#groupresponsedto) with `status: "DELETED"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Not an `OWNER`. |
| 409 | `GROUP_DELETED` | Already deleted. |
| 409 | `GROUP_HAS_ACTIVE_CHILDREN` | One or more Child Groups are not yet `ARCHIVED`/`DELETED` (see the [Error format](#error-format) note — no id list is actually present in the response). |

---

### 37. Ban Member

**HTTP Method:** `POST`
**URL:** `/groups/:id/members/:membershipId/ban`

**Description:** Ends the target's Membership — same effect as
[Remove Member](#15-remove-member) (`GroupMembership.status: "ARCHIVED"`,
`endReason: "BANNED"`) — and additionally records a durable ban that blocks
the user from rejoining (via [Join](#22-join-community)) or being
re-invited (via [Create Invitation](#27-create-invitation)) to this
**Organization** until explicitly unbanned. Ban is always Organization-wide
(scoped to the Root Group, like Membership itself — see ADR-004); there is
no per-Child-Group ban. Removing someone from one specific Child Group
without banning them from the Organization is already covered by
[Revoke Role Assignment](#21-revoke-role-assignment).

Same ownership guard as Remove Member: a target who currently owns any
Group in the Organization's tree cannot be banned until ownership is
transferred first — banning is a stronger form of removal, so it inherits
every restriction removal already has.

**Required authorization:** Role Assignment granting `MEMBERSHIP_BAN`
(`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_BAN`. Requires `ACTIVE` status
(default gate).

**Request**

Path: `id` (Organization UUID), `membershipId` (UUID).

Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `reason` | string (1–1000 chars, trimmed) | No | Free-text, shown to admins reading the [Audit Log](#41-list-audit-log) (`description` field) — never shown to the banned user through any current endpoint. |

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | Target Membership doesn't exist or is already inactive. |
| 409 | `CANNOT_BAN_OWNER` | Target owns one or more Groups (see the [Error format](#error-format) note — no id list is actually present in the response). |
| 409 | `ALREADY_BANNED` | Target already has an active ban for this Organization. In practice only reachable as a concurrent-request race backstop — banning is only ever attempted against an `ACTIVE` Membership, and the first successful ban immediately archives it, so two *sequential* calls with the same `membershipId` surface `MEMBERSHIP_NOT_FOUND` (404) on the second call, not this code. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_BAN`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` / `GROUP_DELETED` | Group isn't `ACTIVE`. |

---

### 38. Unban Member

**HTTP Method:** `POST`
**URL:** `/groups/:id/members/:membershipId/unban`

**Description:** Lifts an active ban, allowing the user to rejoin or be
re-invited again. Does **not** restore the Membership itself — banning is a
terminal action for that Membership stint, exactly like Remove Member; a
returning user rejoins through the normal join/invite flow. `:membershipId`
targets the (necessarily inactive) Membership the ban is attached to.

**Required authorization:** Role Assignment granting `MEMBERSHIP_UNBAN`
(`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_UNBAN`. Requires `ACTIVE` status
(default gate).

**Request:** Path `id` (Organization UUID), `membershipId` (UUID). No body.

**Response** — `204 No Content`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | `membershipId` doesn't exist under this Organization. |
| 404 | `BAN_NOT_FOUND` | This user has no currently-active ban. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_UNBAN`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` / `GROUP_DELETED` | Group isn't `ACTIVE`. |

---

### 39. Suspend Member

**HTTP Method:** `POST`
**URL:** `/groups/:id/members/:membershipId/suspend`

**Description:** Sets the target Membership's `status` to `READ_ONLY` —
**it is not ended** (unlike Ban/Remove): the member keeps their Membership
and every Role Assignment they hold, but loses every operational permission
everywhere until unsuspended, retaining only the small
[READ_ONLY-safe subset](#read_only-membership) (view-only, plus
`AUDIT_LOG_VIEW`) for every Group they participate in — **including an
`OWNER`**, who is not specially protected here (unlike Ban/Remove/Leave,
suspension never ends the Membership, so there is no "Group left ownerless"
risk to guard against).

`until` is optional: omit it for an **indefinite** suspension that only
ends via an explicit [Unsuspend](#40-unsuspend-member). When given, it must
be a future timestamp. **There is no background job that auto-expires a
suspension** — this codebase has no scheduler/cron infrastructure. Instead,
expiry is resolved **lazily**: the next time this Membership's authorization
is checked for any Group (i.e., on the very next request that touches any
Group in the Organization, by anyone), an `until` in the past is detected
and the Membership is silently reconciled back to `ACTIVE` right before that
permission check runs — this happens transparently, with no dedicated
endpoint or webhook to observe it. Do not build a client-side countdown that
assumes reactivation happens exactly at `until`; it happens on the next
relevant request at or after that time.

**Required authorization:** Role Assignment granting `MEMBERSHIP_SUSPEND`
(`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_SUSPEND`. Requires `ACTIVE` status
(default gate).

**Request**

Path: `id` (Organization UUID), `membershipId` (UUID).

Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `until` | string (ISO 8601 datetime) | No | Must be strictly in the future. Omit for an indefinite suspension. |
| `reason` | string (1–1000 chars, trimmed) | No | Free-text, shown to admins reading the [Audit Log](#41-list-audit-log) — never shown to the suspended user through any current endpoint. |

**Response** — `201 Created` (no `@HttpCode` override). Body:
[`GroupMembershipResponseDto`](#groupmembershipresponsedto) with
`status: "READ_ONLY"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 400 | `VALIDATION_ERROR` | `until` is not a valid future datetime. |
| 404 | `MEMBERSHIP_NOT_FOUND` | Target Membership doesn't exist or is already inactive. |
| 409 | `MEMBERSHIP_ALREADY_SUSPENDED` | Membership already has an active suspension. Same race-only caveat as `ALREADY_BANNED` above applies here — a second sequential Suspend call against the same `membershipId` surfaces `MEMBERSHIP_NOT_FOUND` (404), not this code. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_SUSPEND`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` / `GROUP_DELETED` | Group isn't `ACTIVE`. |

---

### 40. Unsuspend Member

**HTTP Method:** `POST`
**URL:** `/groups/:id/members/:membershipId/unsuspend`

**Description:** Manually ends an active suspension early, restoring the
Membership's `status` to `ACTIVE` immediately (equivalent to what would
otherwise happen lazily once `until` passes — see
[Suspend Member](#39-suspend-member)). Only valid while the Membership is
currently `READ_ONLY` **because of a suspension** — this is a Membership-
status check enforced in the service, not a Group-status gate.

**Required authorization:** Role Assignment granting `MEMBERSHIP_UNSUSPEND`
(`ADMIN`/`OWNER`).

**Required permissions:** `MEMBERSHIP_UNSUSPEND`. Requires the **Group** to
be `ACTIVE` (default gate) — independent of the Membership's own status
check described above.

**Request:** Path `id` (Organization UUID), `membershipId` (UUID). No body.

**Response** — `201 Created` (no `@HttpCode` override). Body:
[`GroupMembershipResponseDto`](#groupmembershipresponsedto) with
`status: "ACTIVE"`.

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:id`. |
| 404 | `MEMBERSHIP_NOT_FOUND` | `membershipId` doesn't exist under this Organization. |
| 409 | `MEMBERSHIP_NOT_SUSPENDED` | Membership's status isn't currently `READ_ONLY`. |
| 404 | `SUSPENSION_NOT_FOUND` | Membership is `READ_ONLY` but has no active suspension record (edge case). |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `MEMBERSHIP_UNSUSPEND`. |
| 409 | `GROUP_READ_ONLY` / `GROUP_ARCHIVED` / `GROUP_DELETED` | Group isn't `ACTIVE`. |

---

### 41. List Audit Log

**HTTP Method:** `GET`
**URL:** `/groups/:groupId/audit-log`

**Description:** One generic, paginated/filterable/sortable list endpoint
for every kind of audit event (see
[`AuditLogEntryResponseDto`](#auditlogentryresponsedto) and
[Domain Models → Audit Log Entry](#audit-log-entry)) — **there is no
separate endpoint per event type.**

**Important:** unlike almost every other endpoint in this document,
`:groupId` here is **not** resolved to its Root Group — an `AuditLogEntry`'s
`community` is always the Root Group the action ultimately belongs to (even
for an action on a Child Group, e.g. `CREATE_CHILD_GROUP`), but the query
backing this endpoint filters literally on `community = :groupId`. The
permission check (`AUDIT_LOG_VIEW` on `:groupId` itself) can succeed for a
Child Group where the caller holds a direct Role Assignment, but the result
set will then always be **empty**, since no `AuditLogEntry` ever has a
Child Group as its `community`. **Always pass the Organization's (Root
Group's) id here**, never a Child Group id, to see any results.

**Required authorization:** Role Assignment granting `AUDIT_LOG_VIEW` for
`:groupId`.

**Required permissions:** `AUDIT_LOG_VIEW`. Works in any Group status,
including `DELETED` (historical data remains visible — ADR-007).

**Request**

Path: `groupId` (UUID) — should be a Root Group (see note above).

Query (uses the general `page`/`limit`/`data`+`meta` convention from
`docs/api-conventions.md` — **not** the rest of this module's plain-array
convention; see [Pagination](#pagination)):

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | integer ≥ 1 | No | `1` | |
| `limit` | integer, 1–100 | No | `20` | |
| `action` | one of the [`AuditAction`](#audit-log-entry) values | No | — | Filter to exactly one action type. |
| `actorId` | UUID | No | — | Filter to entries performed by one specific user. |
| `sort` | `"createdAt"` \| `"-createdAt"` | No | `"-createdAt"` | Newest first by default. |

`action` and `actorId` combine with AND semantics when both are given.
There is no free-text search over `description`.

**Response** — `200 OK`, body: `{ data: AuditLogEntryResponseDto[], meta: PaginationMeta }` (see [`AuditLogEntryResponseDto`](#auditlogentryresponsedto) and `docs/api-conventions.md` for the `meta` shape: `page`, `limit`, `totalItems`, `totalPages`, `hasNextPage`, `hasPreviousPage`).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid query (e.g. `action` not a recognized value, `limit` > 100). |
| 404 | `GROUP_NOT_FOUND` | No usable Role Assignment for `:groupId`. |
| 403 | `INSUFFICIENT_GROUP_PERMISSIONS` | Caller lacks `AUDIT_LOG_VIEW`. |

---

### 42. Get Community Notification Settings

**HTTP Method:** `GET`
**URL:** `/groups/:groupId/notification-settings`

**Description:** Returns the caller's **own** notification preferences for
the Organization `:groupId` belongs to (settings are per-`(Organization,
User)`, never per-Child-Group — passing a Child Group id resolves to its
Root Group first). Settings only — this endpoint has no bearing on whether
any notification is actually delivered; there is no delivery mechanism in
this module (see [Domain Models → Community Notification Settings](#community-notification-settings)).

If no settings row exists yet for this `(Organization, User)` pair, every
field defaults to `true` — viewing settings never creates a row, only an
explicit [Update](#43-update-community-notification-settings) does.

**Required authorization:** An `ACTIVE` Membership in the Organization —
**deliberately not gated by any `GroupPermission`/Role Assignment at all**,
unlike every other endpoint in this module. A Membership with **zero** Role
Assignments anywhere (a valid, documented state — see
[Membership](#membership)) can still manage its own notification
preferences; the usual `GroupPermissionsGuard` cannot authorize that case
(it requires at least one Role Assignment to resolve authorization for a
Group at all), so this endpoint checks Membership directly instead.

**Required permissions:** None (see above). Requires the caller's
Membership status to be `ACTIVE` — a `READ_ONLY`/suspended member cannot
read or change these settings while suspended (this is the **one**
Membership-related check in this module that is not part of the
[READ_ONLY-safe subset](#read_only-membership), since it isn't gated by
`GroupPermission` at all).

**Request:** Path `groupId` (UUID, Root or Child — resolved to its Root
Group). No body.

**Response** — `200 OK`, body:
[`CommunityNotificationSettingsResponseDto`](#communitynotificationsettingsresponsedto).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 404 | `GROUP_NOT_FOUND` | Caller has no `ACTIVE` Membership in this Organization — never confirms the Group's existence otherwise, same convention as every other endpoint. |

---

### 43. Update Community Notification Settings

**HTTP Method:** `PATCH`
**URL:** `/groups/:groupId/notification-settings`

**Description:** Partially updates the caller's own notification
preferences — **unlike `UpdateGroupDto`'s full-replace convention**, every
field here is optional and independently applied; an omitted field keeps
its current (or default) value. Creates the underlying settings row lazily
on first call if none exists yet.

**Required authorization / permissions:** Same as
[Get](#42-get-community-notification-settings) above.

**Request**

Path: `groupId` (UUID, Root or Child — resolved to its Root Group).

Body (all fields optional booleans — at least one recommended, but an
empty object `{}` is valid and a no-op):

| Field | Type | Description |
|---|---|---|
| `newJoinRequests` | boolean | A new Join Request was submitted. |
| `joinRequestApproved` | boolean | One of the caller's own Join Requests was approved. |
| `newInvitations` | boolean | The caller received a new Invitation. |
| `invitationAccepted` | boolean | An Invitation the caller sent was accepted. |
| `invitationRejected` | boolean | An Invitation the caller sent was rejected. |
| `roleChanges` | boolean | A Role was granted to or revoked from the caller. |
| `transferOwnership` | boolean | Ownership of a Group was transferred (to or from the caller). |
| `archived` | boolean | A community the caller belongs to was archived. |
| `restored` | boolean | A community the caller belongs to was unarchived. |
| `communityDeleted` | boolean | A community the caller belongs to was permanently deleted. |

**Response** — `200 OK`, body:
[`CommunityNotificationSettingsResponseDto`](#communitynotificationsettingsresponsedto)
(the full, current settings after applying the patch).

**Possible errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is present but not a boolean, or an unrecognized field is present (schema is `.strict()`). |
| 404 | `GROUP_NOT_FOUND` | Caller has no `ACTIVE` Membership in this Organization. |

---

# DTO Reference

## Response DTOs

### GroupResponseDto

Returned by: Create Community, Get Community, Update Community, Archive/
Unarchive/Read-Only/Activate, List Direct Children.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `parentGroupId` | string (UUID) | Yes | `null` ⇒ this is an Organization. |
| `name` | string | No | |
| `description` | string | Yes | |
| `logoUrl` | string | Yes | |
| `coverImageUrl` | string | Yes | |
| `contactEmail` | string | Yes | |
| `contactPhone` | string | Yes | |
| `websiteUrl` | string | Yes | |
| `facebookUrl` | string | Yes | |
| `instagramUrl` | string | Yes | |
| `youtubeUrl` | string | Yes | |
| `isPublic` | boolean | No | |
| `isHidden` | boolean | No | |
| `memberInvitesAllowed` | boolean | No | |
| `publicCode` | string | Yes | `XXXX-XXXX` format. |
| `status` | `"ACTIVE"` \| `"READ_ONLY"` \| `"ARCHIVED"` \| `"DELETED"` | No | `DELETED` is terminal — see [Delete Community](#36-delete-community). |
| `timezone` | string | No | IANA timezone id. |
| `currencyCode` | string | No | 3-letter uppercase code. |
| `createdAt` | string (ISO 8601) | No | |
| `updatedAt` | string (ISO 8601) | No | |

### GroupSummaryResponseDto

Returned by: List My Communities (`GET /groups`). A deliberately smaller
projection than `GroupResponseDto` for dashboard/list cards.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `name` | string | No | |
| `logoUrl` | string | Yes | |
| `isPublic` | boolean | No | |
| `isHidden` | boolean | No | |
| `publicCode` | string | Yes | |
| `status` | `"ACTIVE"` \| `"READ_ONLY"` \| `"ARCHIVED"` | No | |
| `myRoles` | array of `GroupRole` strings | No | Every role the caller holds for this Root Group. May be `[]` — belonging to the Organization never implies any role. **Always an array — never collapse to a single value.** |

Note: this DTO has no `parentGroupId` field at all (every row returned by
`GET /groups` is, by construction, a Root Group).

### GroupMembershipResponseDto

Returned by: List Members, Add Member, Get Membership, and (embedded) by
Transfer Ownership.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | The Membership id — this is what you pass as `membershipId` to Role Assignment / Section endpoints. |
| `rootGroupId` | string (UUID) | No | The Organization this Membership belongs to. |
| `user` | [`GroupUserRefDto`](#groupuserrefdto) | No | |
| `rootRoles` | array of `GroupRole` strings | No | Roles held for the **Root Group only** (not for any Child Group) — always an array, may be `[]`. |
| `status` | `"INVITED"` \| `"ACTIVE"` \| `"READ_ONLY"` \| `"ARCHIVED"` | No | `INVITED` is defined but never actually produced by any current endpoint. |
| `joinedAt` | string (ISO 8601) | No | |
| `leftAt` | string (ISO 8601) | Yes | `null` while active. |
| `endReason` | `"LEFT"` \| `"REMOVED"` | Yes | `null` while active; distinguishes self-service leave from admin removal. |
| `sections` | array of [`MembershipSectionRefDto`](#membershipsectionrefdto) | No | May be `[]`. |

### GroupUserRefDto

Minimal, public-safe user reference. Used inside
`GroupMembershipResponseDto`.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `displayName` | string | No | Never includes email, `clerkUserId`, or global role. |

### MembershipSectionRefDto

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | Section id. |
| `name` | string | No | |

### TransferOwnershipResponseDto

Returned by: Transfer Ownership.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `previousOwner` | [`GroupMembershipResponseDto`](#groupmembershipresponsedto) | No | The Membership that just lost `OWNER` (still reflects any other roles it holds). |
| `newOwner` | [`GroupMembershipResponseDto`](#groupmembershipresponsedto) | No | The Membership that just received `OWNER`. |

### RoleAssignmentResponseDto

Returned by: Grant/List/Get Role Assignment.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | The Role Assignment's own id (used for revoke). |
| `groupId` | string (UUID) | No | The exact Group this role applies to. |
| `membershipId` | string (UUID) | No | |
| `user` | `{ id: string, displayName: string }` | No | Same shape as `GroupUserRefDto`, declared inline. |
| `role` | `GroupRole` string | No | |
| `grantedAt` | string (ISO 8601) | No | |

### MembershipRequestResponseDto

Returned by: Join, Create/List/Cancel/Resend Invitation, List Join
Requests, List My Received Invitations. Represents both an Invitation and a
Join Request — see [Domain Models](#membership-request).

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `type` | `"INVITATION"` \| `"JOIN_REQUEST"` | No | |
| `targetType` | `"ORGANIZATION"` \| `"GROUP"` | No | What accepting this request creates — see [Domain Models](#membership-request). |
| `targetGroupId` | string (UUID) | No | The Group this request targets. |
| `status` | `"PENDING"` \| `"ACCEPTED"` \| `"REJECTED"` \| `"CANCELLED"` | No | |
| `initiatedBy` | `{ id: string, displayName: string }` | No | Who sent the invite, or who is requesting to join. |
| `invitedUser` | `{ id: string, displayName: string }` | Yes | Set only for `INVITATION` rows where the invitee already has an account. |
| `invitedEmail` | string | Yes | Set only for `INVITATION` rows identifying the invitee by email. |
| `processedAt` | string (ISO 8601) | Yes | `null` while `PENDING`. |
| `processedBy` | `{ id: string, displayName: string }` | Yes | `null` while `PENDING`. |
| `createdAt` | string (ISO 8601) | No | |
| `updatedAt` | string (ISO 8601) | No | |

There is **no `expiresAt` field and no expiration mechanism** — a `PENDING`
request stays pending until explicitly accepted/rejected/cancelled/
withdrawn. There is **no field carrying a proposed role** for an
Invitation — accepting a `GROUP`-target request always grants exactly
`MEMBER`, never a higher role; a higher role must be granted separately
afterward via [Role Assignments](#role-assignments).

### DiscoveredResourceDto

Returned by: Resolve by Public Code, Search Groups.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `resourceType` | `"USER"` \| `"GROUP"` \| `"ORGANIZATION"` | No | |
| `group` | [`PublicGroupProfileDto`](#publicgroupprofiledto) | Yes | Non-null iff `resourceType` is `"GROUP"` or `"ORGANIZATION"`. |
| `user` | [`PublicUserProfileDto`](#publicuserprofiledto) | Yes | Non-null iff `resourceType` is `"USER"`. |
| `isMember` | boolean | No | Whether the caller already has an active Membership (only meaningful when `group` is set). |
| `hasPendingRequest` | boolean | No | Whether the caller has a pending Invitation or Join Request for this Group. |

### PublicGroupProfileDto

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `name` | string | No | |
| `description` | string | Yes | |
| `logoUrl` | string | Yes | |
| `coverImageUrl` | string | Yes | |
| `websiteUrl` | string | Yes | |
| `status` | `"ACTIVE"` \| `"READ_ONLY"` \| `"ARCHIVED"` \| `"DELETED"` | No | Search results are always `ACTIVE` in practice (the query filters for it), but resolve-by-code can return any status, including `DELETED`. |
| `isPublic` | boolean | No | |
| `isHidden` | boolean | No | |
| `publicCode` | string | Yes | |
| `isOrganization` | boolean | No | `true` iff `parentGroup === null`. Use this (not `parentGroupId`, which isn't exposed here) to decide `targetType` when calling Join. |

### PublicUserProfileDto

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `displayName` | string | No | |
| `avatarUrl` | string | Yes | |
| `publicCode` | string | Yes | |

### AuditLogEntryResponseDto

Returned by: [List Audit Log](#41-list-audit-log).

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | The entry's own id. |
| `communityId` | string (UUID) | No | Always a Root Group id — see the note under [List Audit Log](#41-list-audit-log). |
| `action` | one of the 21 [`AuditAction`](#audit-log-entry) values | No | |
| `actor` | `{ id: string, displayName: string }` | Yes | `null` only for a hypothetical future system-initiated entry — every action logged today is actor-initiated. |
| `target` | `{ type: "COMMUNITY" \| "USER" \| "ROLE_ASSIGNMENT" \| "MEMBERSHIP_REQUEST", id: string }` | Yes | `null` iff the action has no single natural target. The *conceptual* target is always what an admin reading the log cares about — e.g. `BAN`'s target is the affected `USER`, even though the underlying rows that changed are a `GroupMembership` and a `GroupBan`. |
| `description` | string | Yes | Free text — currently only ever set from a `reason` given to [Ban](#37-ban-member)/[Suspend Member](#39-suspend-member). |
| `metadata` | object | Yes | Action-specific extra data, e.g. `SUSPEND` includes `{ "until": string \| null }`. Shape varies per `action` and is not separately documented per-field — treat as opaque, optional context, never required to render the log. |
| `createdAt` | string (ISO 8601) | No | |

### CommunityNotificationSettingsResponseDto

Returned by: [Get](#42-get-community-notification-settings)/[Update Community Notification Settings](#43-update-community-notification-settings).

| Field | Type | Nullable | Description |
|---|---|---|---|
| `communityId` | string (UUID) | No | Always the Organization's (Root Group's) id, even if a Child Group id was passed to the request. |
| `newJoinRequests` | boolean | No | Defaults to `true` when no settings row exists yet. |
| `joinRequestApproved` | boolean | No | Same default. |
| `newInvitations` | boolean | No | Same default. |
| `invitationAccepted` | boolean | No | Same default. |
| `invitationRejected` | boolean | No | Same default. |
| `roleChanges` | boolean | No | Same default. |
| `transferOwnership` | boolean | No | Same default. |
| `archived` | boolean | No | Same default. |
| `restored` | boolean | No | Same default. |
| `communityDeleted` | boolean | No | Same default. |

Every field defaults to `true` — every new member starts opted into every
notification type, and must explicitly opt out per-field. There is no
single "notifications enabled/disabled" master toggle.

## Request DTOs (bodies)

These are documented per-field already under each endpoint above; this is
a compact index.

| Schema | Used by |
|---|---|
| `CreateGroupDto` | Create Community |
| `UpdateGroupDto` | Update Community — identical to `CreateGroupDto` minus `parentGroupId` |
| `AddMemberDto` | Add Member |
| `CreateRoleAssignmentDto` | Grant Role Assignment |
| `TransferOwnershipDto` | Transfer Ownership |
| `JoinGroupDto` | Join Community |
| `CreateInvitationDto` | Create Invitation |
| `BanMemberDto` | Ban Member |
| `SuspendMemberDto` | Suspend Member |
| `UpdateCommunityNotificationSettingsDto` | Update Community Notification Settings — the one exception to "documented per-field under its endpoint": every field is optional (partial-patch), unlike `UpdateGroupDto`'s full-replace convention. |

Shared value constraint: the "assignable group role" accepted by
`AddMemberDto.role` and `CreateRoleAssignmentDto.role` is always one of
`"ADMIN"`, `"INSTRUCTOR"`, `"ASSISTANT"`, `"MEMBER"` — **never** `"OWNER"`,
on any endpoint that accepts a role in its body.

---

# Domain Models

This section describes each concept only to the depth a frontend needs to
render screens and interpret responses. For the full business-rule
specification (invariants, lifecycle guarantees, edge cases), see
`docs/architecture/organization-domain.md` and
`docs/architecture/organization-entities.md` — this document does not
repeat that material.

## Organization

Not a distinct entity — a `Group` row where `parentGroupId` is `null`. A
user's relationship to an Organization is their `Membership` (see below).
Every field on `GroupResponseDto` applies equally to Organizations and
Groups; there is no Organization-only field.

## Group

Same entity as Organization, with a non-null `parentGroupId`. Hierarchy
depth is unlimited on the backend — a Group's parent can itself be a Child
Group. A user does **not** need a separate Membership to participate in a
Group under an Organization they already belong to — participation in a
specific (Root or Child) Group is expressed by holding a `RoleAssignment`
there, not by a second Membership.

`status` is one of four values: `ACTIVE`, `READ_ONLY`, `ARCHIVED`,
`DELETED`. `ARCHIVED` is reversible (see [Unarchive](#6-unarchive-community)).
`DELETED` is a fourth, **terminal** status added for
[Delete Community](#36-delete-community) — unlike `ARCHIVED`, no endpoint
ever moves a Group back out of `DELETED`. Both are equally non-physical: no
Group row is ever actually removed from the database (see
`docs/decisions/ADR-007-soft-delete.md`), so every Membership,
RoleAssignment, MembershipRequest, and AuditLogEntry referencing a
`DELETED` Group's id remains valid and readable forever, exactly as it does
for `ARCHIVED`. See `docs/decisions/ADR-029-community-deletion.md` for the
full rationale.

## Membership

A user's relationship to exactly one Organization (Root Group) — answers
only "does this user belong to this Organization at all." A `Membership`
row:

- Always references a Root Group, never a Child Group.
- Has a `status`: `ACTIVE`, `READ_ONLY`, `ARCHIVED` (`INVITED` exists in the
  enum but is never produced today — see [`GroupMembershipResponseDto`](#groupmembershipresponsedto)).
  `READ_ONLY` is produced by exactly one action today —
  [Suspend Member](#39-suspend-member) — and reverted either by
  [Unsuspend Member](#40-unsuspend-member) or lazily once the suspension's
  `until` passes (see that endpoint's description).
- Carries **no role by itself.** An `ACTIVE` Membership with zero
  `RoleAssignment`s anywhere is a normal, valid state — see
  `GroupSummaryResponseDto.myRoles: []`.
- Is never deleted — ending it (leave, admin removal, or
  [ban](#37-ban-member)) sets `status: ARCHIVED` and records `endReason`
  (`LEFT` / `REMOVED` / `BANNED`), so history is preserved and a user can
  rejoin later with a fresh Membership (unless an active ban blocks it —
  see [Ban](#ban)).

## Ban

Not exposed as its own response DTO — a durable record (`GroupBan`) that a
user is banned from an Organization, independent of the `Membership` row it
ended. Scoped to the Organization (Root Group) only, mirroring Membership's
own scope — there is no per-Child-Group ban (see
[Ban Member](#37-ban-member) for why). While a ban is active (not yet
lifted), it blocks:

- Auto-approval / creation via [Join Community](#22-join-community),
- Being named as the invitee in [Create Invitation](#27-create-invitation).

Both cases surface as `403 USER_BANNED`. [Unban Member](#38-unban-member)
lifts a ban without restoring the Membership itself — a returning user
rejoins through the normal join/invite flow. A user banned again after
being unbanned gets a brand-new ban record, never a reused one.

## Suspension

Not exposed as its own response DTO — a durable record
(`MembershipSuspension`) attached to a `Membership`, created by
[Suspend Member](#39-suspend-member) and reflected on the Membership itself
purely via `status: "READ_ONLY"` (there is no separate "suspended" boolean
anywhere in the API — `READ_ONLY` **is** the suspended state). Carries
`until` (nullable — `null` means indefinite) and an optional `reason`
(surfaced in the [Audit Log](#audit-log-entry)'s `description`). See
[Suspend Member](#39-suspend-member) for the full lazy-expiry behavior.

## Invitation

Not a distinct entity. An "Invitation" is a `MembershipRequest` row (see
below) with `type: "INVITATION"` — created by an existing member on behalf
of someone else (an account by id, or an email address). See
[Membership Request](#membership-request) for the full shape.

## Membership Request

The single entity backing both Invitations and Join Requests
(`MembershipRequest`, exposed as `MembershipRequestResponseDto`). The
`type` field (`"INVITATION"` vs `"JOIN_REQUEST"`) distinguishes who
initiated it; the `targetType` field (`"ORGANIZATION"` vs `"GROUP"`)
determines what accepting it creates:

- `targetType: "ORGANIZATION"` → accepting creates/reactivates a Membership
  only. No role is granted anywhere.
- `targetType: "GROUP"` → accepting ensures Membership in the Organization
  **and** grants `MEMBER` on the exact target Group.

Lifecycle: `PENDING → ACCEPTED | REJECTED | CANCELLED`. All three end
states are terminal — a request is never reopened or reused; a "resend"
creates an entirely new row with a new id.

## Role Assignment

Grants exactly one `GroupRole` (`OWNER`, `ADMIN`, `INSTRUCTOR`,
`ASSISTANT`, `MEMBER`) to a Membership, for exactly one Group (Root or
Child). A Membership may hold **several different roles for the same Group
at once** — e.g. `MEMBER` + `INSTRUCTOR` + `ADMIN` simultaneously, each its
own `RoleAssignment` row. Roles **never inherit** through the hierarchy: a
role held for a parent Group grants nothing in a child, and vice versa.
Every Group always has exactly one `OWNER`, moved only via
[Transfer Ownership](#10-transfer-ownership).

## Audit Log Entry

One immutable row per recorded action (`AuditLogEntry`, exposed as
[`AuditLogEntryResponseDto`](#auditlogentryresponsedto), read via
[List Audit Log](#41-list-audit-log)). `communityId` is **always** a Root
Group id, even for an entry describing an action on a Child Group (see
that endpoint's important caveat about querying by Child Group id).
Entries are never edited or deleted — only ever created.

The fixed set of 21 `action` values (`AuditAction`), grouped by the concept
they belong to:

| Concept | Actions |
|---|---|
| Community lifecycle | `CREATE_COMMUNITY`, `UPDATE_COMMUNITY`, `ARCHIVE`, `RESTORE`, `DELETE`, `CREATE_CHILD_GROUP`, `TRANSFER_OWNERSHIP` |
| Invitations & Join Requests | `INVITE_MEMBER`, `ACCEPT_INVITATION`, `DECLINE_INVITATION`, `JOIN_REQUEST`, `APPROVE_JOIN_REQUEST`, `REJECT_JOIN_REQUEST` |
| Roles | `ADD_ROLE`, `REMOVE_ROLE` |
| Membership | `REMOVE_MEMBER`, `LEAVE_COMMUNITY` |
| Moderation | `BAN`, `UNBAN`, `SUSPEND`, `UNSUSPEND` |

Not every mutation in this module is logged — only the 21 actions above.
Notably absent (by design, not omission): Cancel/Resend Invitation,
Withdraw Join Request, Assign/Unassign Section, Set Read-Only/Activate (the
two least consequential lifecycle transitions). The lazy suspension-expiry
reconciliation described under [Suspend Member](#39-suspend-member) is also
deliberately **not** logged as an `UNSUSPEND` entry — no actor performed
it, so recording one would misattribute a passive, time-driven side effect
as someone's action.

## Community Notification Settings

A single row per `(Organization, User)` pair
(`CommunityNotificationSettings`, exposed as
[`CommunityNotificationSettingsResponseDto`](#communitynotificationsettingsresponsedto)),
read/written via [Get](#42-get-community-notification-settings)/
[Update Community Notification Settings](#43-update-community-notification-settings).
**Settings only** — this entity has no bearing on whether any notification
is actually delivered by any channel (push, email, in-app); no delivery
mechanism exists anywhere in this module today. Scoped to the Organization,
never to a Child Group individually (mirrors Membership's own scope). Every
field defaults to `true` and the row is created lazily on first update —
viewing settings before ever changing them returns all-`true` defaults
without persisting anything.

---

# Capability Flags

**Capability flags exist in exactly one place today: `GET /community/home`**
(`response.capabilities`). No other endpoint in this module returns a
capability flag of any kind. Do not assume any other list/detail endpoint
carries permission hints beyond what's documented for it above (e.g.
`GroupSummaryResponseDto.myRoles` tells you *what roles* the caller holds,
but not, by itself, *what actions* those roles allow — that still requires
consulting the [Role → Permission reference](#role--permission-reference),
or, preferably, a capability flag where one exists).

| Flag | Type | Meaning |
|---|---|---|
| `canCreateOrganization` | `boolean` | Always `true` for any signed-in user — creating a Root Group requires no permission. Included for API symmetry/explicitness, not because it's ever conditional. |
| `canCreateGroupInCommunityIds` | `string[]` | The list of Group ids (Organizations or Child Groups) where the caller currently holds `GROUP_EDIT` — i.e., where `POST /groups` with that id as `parentGroupId` would succeed. Empty array, not `false`, when there are none. |
| `canCreateEventInCommunityIds` | `string[]` | The list of Group ids (Organizations or Child Groups) where the caller currently holds `GROUP_EDIT`'s Events counterpart, `EVENT_CREATE` (`ADMIN`/`OWNER`) — i.e., where `POST /groups/:id/events` (see [events-api.md](events-api.md#1-create-event)) would succeed. Requires the community to be `ACTIVE`. Lets the frontend show a "Create Event" action per community without guessing eligibility from `myRoles`. |
| `canReviewJoinRequestsInCommunityIds` | `string[]` | The list of Group ids where the caller can currently call [Approve](#25-approve-join-request)/[Reject Join Request](#26-reject-join-request) — i.e., holds `GROUP_JOIN_REQUEST_REVIEW` **and** that Group's status is `ACTIVE` (a `READ_ONLY` Group is excluded here even for an `OWNER`, since the approve/reject endpoints require `ACTIVE`). |
| `canViewMembersInCommunityIds` | `string[]` | Holds `GROUP_VIEW` (i.e. any Role at all) for the community — works in any Group status, so this list is the broadest of the new member-management flags. Use it to decide whether to show the Members tab at all. |
| `canManageMembersInCommunityIds` | `string[]` | Holds `MEMBERSHIP_ADD`/`MEMBERSHIP_REMOVE` (`ADMIN`/`OWNER`) **and** the Group is `ACTIVE` — i.e. [Add Member](#13-add-member)/[Remove Member](#15-remove-member) would succeed. Previously the frontend had no choice but to reuse `canCreateGroupInCommunityIds` (`GROUP_EDIT`) as a stand-in for this — that reuse is no longer necessary. |
| `canInviteMembersInCommunityIds` | `string[]` | Holds `GROUP_INVITE` for the community — for a caller whose only roles are `MEMBER`/`ASSISTANT`/`INSTRUCTOR`, additionally requires `Group.memberInvitesAllowed === true` (see the [Role → Permission reference](#role--permission-reference) footnote); `ADMIN`/`OWNER` bypass that setting. Requires `ACTIVE`. |
| `canManageInvitationsInCommunityIds` | `string[]` | Holds `MEMBERSHIP_INVITE` (`ADMIN`/`OWNER`) — i.e. can [Cancel](#29-cancel-invitation)/[Resend Invitation](#30-resend-invitation) on another member's behalf. Requires `ACTIVE`. |
| `canManageRolesInCommunityIds` | `string[]` | Holds `MEMBERSHIP_ROLE_CHANGE` (`ADMIN`/`OWNER`) — i.e. [Grant](#18-grant-role-assignment)/[Revoke Role Assignment](#21-revoke-role-assignment) would succeed. Requires `ACTIVE`. |
| `canTransferOwnershipInCommunityIds` | `string[]` | Holds `GROUP_OWNERSHIP_TRANSFER` (`OWNER`-only) — i.e. [Transfer Ownership](#10-transfer-ownership) would succeed. Requires `ACTIVE`. |
| `canArchiveCommunityIds` | `string[]` | Holds `GROUP_ARCHIVE` (`OWNER`-only) — i.e. [Archive](#5-archive-community) would succeed. Valid from `ACTIVE` or `READ_ONLY`. |
| `canRestoreCommunityIds` | `string[]` | Holds `GROUP_UNARCHIVE` (`OWNER`-only) and the community is currently `ARCHIVED` — i.e. [Unarchive](#6-unarchive-community) would succeed. **Unlike every other list here, ids in this one are not necessarily present in `myCommunities`** (`ARCHIVED` communities are excluded from it — see [myCommunities](#mycommunities--communityhomecommunitydto)); resolve the community's own name/logo via [Get Community](#3-get-community) if you need to display it. |
| `canDeleteCommunityIds` | `string[]` | Holds `GROUP_DELETE` (`OWNER`-only, see [Delete Community](#36-delete-community)) — valid from `ACTIVE`, `READ_ONLY`, or `ARCHIVED`. Same "may not be in `myCommunities`" note as `canRestoreCommunityIds` applies to any `ARCHIVED` community here. |
| `canViewAuditLogInCommunityIds` | `string[]` | Holds `AUDIT_LOG_VIEW` (`ADMIN`/`OWNER`) — works in **any** Group status, including `DELETED` (historical data remains visible — ADR-007). |
| `canManageNotificationsInCommunityIds` | `string[]` | The community has an `ACTIVE` Membership — **not** Role/Permission-gated like every other flag here (see [Community Notification Settings](#community-notification-settings)): a zero-Role Membership still manages its own preferences the same way an `OWNER` does. |
| `canBanMembersInCommunityIds` | `string[]` | Holds `MEMBERSHIP_BAN`/`MEMBERSHIP_UNBAN` (`ADMIN`/`OWNER`) — i.e. [Ban](#37-ban-member)/[Unban Member](#38-unban-member) would succeed. Requires `ACTIVE`. |
| `canSuspendMembersInCommunityIds` | `string[]` | Holds `MEMBERSHIP_SUSPEND`/`MEMBERSHIP_UNSUSPEND` (`ADMIN`/`OWNER`) — i.e. [Suspend](#39-suspend-member)/[Unsuspend Member](#40-unsuspend-member) would succeed. Requires `ACTIVE`. |
| `canManageAnyCommunity` | `boolean` | `true` iff `canCreateGroupInCommunityIds` is non-empty. A convenience aggregate, not an independently-computed rule — unaffected by the 13 flags above. |

**The frontend must never compute these itself** (e.g. by re-deriving
`GROUP_EDIT`/`GROUP_JOIN_REQUEST_REVIEW` from `myRoles` and the
[Role → Permission table](#role--permission-reference) locally) — always
read them from this response. The backend is the only source of truth for
what a given role currently grants, and that table can change independently
of the frontend's release cycle. **None of these flags ever return a role
name** — every one is either a plain `boolean` or a `string[]` of community
ids; the frontend must never attempt to compute a capability from a
`Permission` or `GroupRole` value itself.

---

# Community Home

**`GET /community/home`** — the single aggregation endpoint backing the
Community Home dashboard. Requires a signed-in user; **no group-permission
guard** (it spans every community the caller belongs to, so there is no
single Group to check a permission against at the controller level —
authorization for each section is instead resolved per-community inside
the service, using the exact same permission system as every other
endpoint).

No query parameters. No request body.

## Response — `CommunityHomeResponseDto`

| Field | Type | Description |
|---|---|---|
| `myCommunities` | array of [`CommunityHomeCommunityDto`](#mycommunities--communityhomecommunitydto) | See below. Full array, not paginated. |
| `pendingInvitations` | [`CommunityHomeBoundedSectionDto<CommunityHomeInvitationDto>`](#bounded-section-shape) | Capped at 20. |
| `pendingJoinRequests` | [`CommunityHomeBoundedSectionDto<CommunityHomeJoinRequestDto>`](#bounded-section-shape) | Capped at 20. |
| `summary` | [`CommunityHomeSummaryDto`](#communityhomesummarydto) | Counters. |
| `capabilities` | [`CommunityHomeCapabilitiesDto`](#capability-flags) | See [Capability Flags](#capability-flags) above. |

### myCommunities — `CommunityHomeCommunityDto[]`

**Unlike `GET /groups`, this includes both Organizations and Child
Groups** — every Organization where the caller has an `ACTIVE` **or
`READ_ONLY`** Membership (even with zero roles there — `READ_ONLY` here
means the caller's own Membership is currently suspended, see
[Suspend Member](#39-suspend-member); their community still appears, they
simply keep only the READ_ONLY-safe capabilities), plus every Child Group
(at any hierarchy depth) where the caller holds at least one
`RoleAssignment`. `ARCHIVED` and `DELETED` communities are excluded
entirely from this array; `READ_ONLY` ones are included. (Note:
[`canRestoreCommunityIds`](#capability-flags)/[`canDeleteCommunityIds`](#capability-flags)
can still list an `ARCHIVED` community's id even though it doesn't appear
here — see those flags' own descriptions.)

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `name` | string | No | |
| `description` | string | Yes | |
| `logoUrl` | string | Yes | |
| `coverImageUrl` | string | Yes | |
| `parentGroupId` | string (UUID) | Yes | The **immediate** parent — `null` for an Organization. For a deeply-nested Child Group this may be a Group that is *not itself* present in `myCommunities` (see `rootGroupId` instead for grouping). |
| `rootGroupId` | string (UUID) | No | The Organization this community belongs to. Equal to `id` for an Organization row. Use this to group cards under their Organization in the UI. |
| `isRootGroup` | boolean | No | `true` iff `parentGroupId === null`. |
| `myRoles` | array of `GroupRole` strings | No | Every role the caller holds for **this exact community** (not the Organization as a whole). May be `[]` for an Organization row when the caller hasn't been assigned any role there yet. |
| `isPublic` | boolean | No | |
| `isHidden` | boolean | No | |
| `status` | `"ACTIVE"` \| `"READ_ONLY"` | No | `ARCHIVED` communities never appear here. |

There is **no `memberCount` field** — it is not implemented anywhere in the
backend yet.

### Bounded section shape

`pendingInvitations` and `pendingJoinRequests` both share this envelope:

| Field | Type | Description |
|---|---|---|
| `items` | array | The first 20 matching rows (see item shape below). |
| `total` | number | The **full** matching count, not just `items.length` — use this to decide whether to show a "See all" link. |
| `hasMore` | boolean | `total > items.length`. |

`CommunityHomeInvitationDto` (item shape for `pendingInvitations`):

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | The underlying Membership Request id — pass this to [Accept](#32-accept-invitation)/[Reject Invitation](#33-reject-invitation). |
| `community` | [`CommunityHomeCommunityRefDto`](#communityhomecommunityrefdto) | No | The community this invitation is for. May be a community **not** in `myCommunities` (you haven't joined it yet). |
| `inviter` | `{ id: string, displayName: string }` | No | |
| `targetType` | `"ORGANIZATION"` \| `"GROUP"` | No | |
| `status` | `"PENDING"` | No | Always `PENDING` in this list; included for shape consistency with other request displays. |
| `createdAt` | string (ISO 8601) | No | |

`CommunityHomeJoinRequestDto` (item shape for `pendingJoinRequests`):

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | Pass this to [Approve](#25-approve-join-request)/[Reject Join Request](#26-reject-join-request). |
| `community` | [`CommunityHomeCommunityRefDto`](#communityhomecommunityrefdto) | No | Always a community the caller can currently review (see `canReviewJoinRequestsInCommunityIds`). |
| `requestedBy` | `{ id: string, displayName: string }` | No | The prospective member. |
| `targetType` | `"ORGANIZATION"` \| `"GROUP"` | No | |
| `status` | `"PENDING"` | No | |
| `createdAt` | string (ISO 8601) | No | |

### CommunityHomeCommunityRefDto

A minimal reference embedded in invitation/join-request cards — not the
full `CommunityHomeCommunityDto`.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | string (UUID) | No | |
| `name` | string | No | |
| `logoUrl` | string | Yes | |
| `isRootGroup` | boolean | No | |

### CommunityHomeSummaryDto

| Field | Type | Description |
|---|---|---|
| `communitiesCount` | number | Equals `myCommunities.length` exactly. |
| `pendingInvitationsCount` | number | Equals `pendingInvitations.total` (the full count, not the capped `items.length`). |
| `pendingJoinRequestsCount` | number | Equals `pendingJoinRequests.total`. |
| `actionableItemsCount` | number | `pendingInvitationsCount + pendingJoinRequestsCount`. |

### capabilities

See [Capability Flags](#capability-flags) — identical shape and meaning.

## Possible errors

None beyond the global `401`. This endpoint has no path/query/body
parameters to validate and performs no group-scoped permission check at
the controller level.

---

# Examples

## POST /groups → 201

Request body:

```json
{
  "parentGroupId": null,
  "name": "Cordão de Ouro",
  "description": "International Capoeira Angola organization.",
  "logoUrl": "https://cdn.example.com/logos/cordao-de-ouro.png",
  "coverImageUrl": null,
  "contactEmail": "contact@cordaodeouro.example",
  "contactPhone": null,
  "websiteUrl": "https://cordaodeouro.example",
  "facebookUrl": null,
  "instagramUrl": null,
  "youtubeUrl": null,
  "isPublic": true,
  "isHidden": false,
  "memberInvitesAllowed": false,
  "timezone": "Europe/Warsaw",
  "currencyCode": "PLN"
}
```

Response:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "parentGroupId": null,
  "name": "Cordão de Ouro",
  "description": "International Capoeira Angola organization.",
  "logoUrl": "https://cdn.example.com/logos/cordao-de-ouro.png",
  "coverImageUrl": null,
  "contactEmail": "contact@cordaodeouro.example",
  "contactPhone": null,
  "websiteUrl": "https://cordaodeouro.example",
  "facebookUrl": null,
  "instagramUrl": null,
  "youtubeUrl": null,
  "isPublic": true,
  "isHidden": false,
  "memberInvitesAllowed": false,
  "publicCode": "K7M2-QN4X",
  "status": "ACTIVE",
  "timezone": "Europe/Warsaw",
  "currencyCode": "PLN",
  "createdAt": "2026-07-22T10:00:00.000Z",
  "updatedAt": "2026-07-22T10:00:00.000Z"
}
```

## GET /groups → 200

```json
[
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Cordão de Ouro",
    "logoUrl": "https://cdn.example.com/logos/cordao-de-ouro.png",
    "isPublic": true,
    "isHidden": false,
    "publicCode": "K7M2-QN4X",
    "status": "ACTIVE",
    "myRoles": ["OWNER", "MEMBER"]
  }
]
```

## POST /groups/:groupId/join → 200 (two possible shapes)

Public group (auto-join):

```json
{ "joined": true }
```

Private group (creates a Join Request):

```json
{
  "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "type": "JOIN_REQUEST",
  "targetType": "ORGANIZATION",
  "targetGroupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "status": "PENDING",
  "initiatedBy": { "id": "user-123", "displayName": "Ana Silva" },
  "invitedUser": null,
  "invitedEmail": null,
  "processedAt": null,
  "processedBy": null,
  "createdAt": "2026-07-22T10:05:00.000Z",
  "updatedAt": "2026-07-22T10:05:00.000Z"
}
```

## GET /discovery/groups?q=cord → 200

```json
[
  {
    "resourceType": "ORGANIZATION",
    "group": {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "name": "Cordão de Ouro",
      "description": "International Capoeira Angola organization.",
      "logoUrl": "https://cdn.example.com/logos/cordao-de-ouro.png",
      "coverImageUrl": null,
      "websiteUrl": "https://cordaodeouro.example",
      "status": "ACTIVE",
      "isPublic": true,
      "isHidden": false,
      "publicCode": "K7M2-QN4X",
      "isOrganization": true
    },
    "user": null,
    "isMember": false,
    "hasPendingRequest": false
  }
]
```

## GET /community/home → 200

```json
{
  "myCommunities": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "name": "Cordão de Ouro",
      "description": "International Capoeira Angola organization.",
      "logoUrl": "https://cdn.example.com/logos/cordao-de-ouro.png",
      "coverImageUrl": null,
      "parentGroupId": null,
      "rootGroupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "isRootGroup": true,
      "myRoles": ["OWNER", "MEMBER"],
      "isPublic": true,
      "isHidden": false,
      "status": "ACTIVE"
    },
    {
      "id": "6b3e6f2a-9c2d-4a3b-8f1e-1a2b3c4d5e6f",
      "name": "Poznań",
      "description": null,
      "logoUrl": null,
      "coverImageUrl": null,
      "parentGroupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "rootGroupId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "isRootGroup": false,
      "myRoles": ["MEMBER", "INSTRUCTOR"],
      "isPublic": true,
      "isHidden": false,
      "status": "ACTIVE"
    }
  ],
  "pendingInvitations": {
    "items": [],
    "total": 0,
    "hasMore": false
  },
  "pendingJoinRequests": {
    "items": [
      {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "community": {
          "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          "name": "Cordão de Ouro",
          "logoUrl": "https://cdn.example.com/logos/cordao-de-ouro.png",
          "isRootGroup": true
        },
        "requestedBy": { "id": "user-456", "displayName": "Bruno Costa" },
        "targetType": "ORGANIZATION",
        "status": "PENDING",
        "createdAt": "2026-07-22T09:00:00.000Z"
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "summary": {
    "communitiesCount": 2,
    "pendingInvitationsCount": 0,
    "pendingJoinRequestsCount": 1,
    "actionableItemsCount": 1
  },
  "capabilities": {
    "canCreateOrganization": true,
    "canCreateGroupInCommunityIds": ["3fa85f64-5717-4562-b3fc-2c963f66afa6"],
    "canReviewJoinRequestsInCommunityIds": ["3fa85f64-5717-4562-b3fc-2c963f66afa6"],
    "canManageAnyCommunity": true
  }
}
```

---

# Frontend Notes

## Fields meant for display

Every field on `GroupResponseDto`/`GroupSummaryResponseDto`/
`CommunityHomeCommunityDto` except `id`, `parentGroupId`, `rootGroupId`,
and `publicCode` is presentation data (name, description, logo/cover URLs,
contact/social links, `status`, `isPublic`/`isHidden` as toggles). `status`
should drive a visible badge ("Archived" / "Read-only") rather than being
hidden — several write actions are blocked (`409`) while a community is
`READ_ONLY`/`ARCHIVED`, so surfacing the status avoids the user hitting a
disabled action with no explanation (see general "Permission Transparency"
principle — capability flags plus `status` together are what should decide
whether an action is shown, not a guess).

## Fields meant only for logic (not for direct display)

- `parentGroupId`, `rootGroupId`, every `*Id`/`*GroupId`/`membershipId`/
  `roleAssignmentId` field — used to build the next request, never rendered
  as-is.
- `myRoles` / `rootRoles` — drive which UI actions to *offer*, but the
  actual permission truth for whether an action will succeed is the
  [Role → Permission table](#role--permission-reference) plus
  [capability flags](#capability-flags), not a client-side "if role ==
  OWNER" check, since a Membership can hold several roles at once and their
  permissions union together.
- `isOrganization` (Discovery) / `isRootGroup` (Community Home) — used to
  pick which screen variant or `targetType` to use, per
  `docs/architecture/PAD-001-community.md` §3.3 "Shared Screens."

## Endpoints worth caching

- `GET /groups` (My Communities/Organizations list) and
  `GET /community/home` (dashboard) are natural React Query-style cache
  candidates — both are read-only, scoped to the caller, and referenced
  from multiple screens.
- `GET /discovery/groups` is safe to cache **keyed by the exact `q` value**
  used (results are user-scoped via `isMember`/`hasPendingRequest`, so
  never share a cache entry across different signed-in users).
- `GET /groups/:id` — cache per `id`; invalidate on any successful
  Update/Archive/Unarchive/Read-Only/Activate/Transfer-Ownership/
  [Delete](#36-delete-community) call for that same `id`.
- `GET /groups/:groupId/audit-log` — cache per `(groupId, page, action,
  actorId, sort)` tuple; safe to treat as append-only (new entries are only
  ever added, never edited/removed), but simplest to just invalidate it
  alongside every mutation in the table below, same as `GET /community/home`.
- `GET /groups/:groupId/notification-settings` — cache per `groupId`
  (already scoped to the caller server-side); invalidate on a successful
  [Update](#43-update-community-notification-settings) for that same
  `groupId`.

## Which mutations should refresh which queries

| Mutation | Should invalidate/refetch |
|---|---|
| Create Community | `GET /groups`, `GET /community/home` |
| Update / Archive / Unarchive / Read-Only / Activate Community | `GET /groups/:id`, `GET /groups` (status/name may have changed), `GET /community/home` |
| [Delete Community](#36-delete-community) | `GET /groups/:id`, `GET /groups`, `GET /community/home`, `GET /groups/:id/audit-log` (records the `DELETE` action itself) |
| Transfer Ownership | `GET /groups/:id/members`, `GET /groups/:id/role-assignments`, `GET /community/home` (capability flags depend on role) |
| Leave Community | `GET /groups`, `GET /groups/:id/members`, `GET /community/home` |
| Add / Remove Member, Grant / Revoke Role Assignment | `GET /groups/:id/members`, `GET /groups/:groupId/role-assignments`, `GET /community/home` (a role change can add/remove capabilities) |
| [Ban](#37-ban-member) / [Unban Member](#38-unban-member) | `GET /groups/:id/members`, `GET /groups/:id/members/:membershipId`, `GET /community/home` |
| [Suspend](#39-suspend-member) / [Unsuspend Member](#40-unsuspend-member) | `GET /groups/:id/members`, `GET /groups/:id/members/:membershipId`, `GET /community/home` (the caller's own suspension can change what `myCommunities`/capabilities show them) |
| Assign / Unassign Section | `GET /groups/:id/members/:membershipId` (or the members list, if it's cached) |
| Join / Withdraw Join Request | `GET /community/home`, `GET /discovery/groups` (`isMember`/`hasPendingRequest` on that result changed) |
| Create / Cancel / Resend Invitation | `GET /groups/:groupId/invitations`, `GET /community/home` (for the recipient, not the actor — no client-observable effect for the actor beyond this list) |
| Accept / Reject Invitation | `GET /invitations`, `GET /groups` (Accept only), `GET /community/home` |
| Approve / Reject Join Request | `GET /groups/:groupId/join-requests`, `GET /community/home` |
| [Update Community Notification Settings](#43-update-community-notification-settings) | `GET /groups/:groupId/notification-settings` — no other query is affected (settings have no bearing on any other endpoint's response). |

## Capability flags to respect

Everywhere `GET /community/home` provides a capability flag, use it instead
of re-deriving the equivalent condition from roles/permissions locally —
see [Capability Flags](#capability-flags) for the full rationale and the
exact list. Outside of `GET /community/home`, no other endpoint exposes a
capability flag today; showing/hiding an action elsewhere (e.g. on a
Community Details screen fed by `GET /groups/:id`) currently requires
consulting the [Role → Permission reference](#role--permission-reference)
against whatever roles you have for that Group (e.g. from
`GET /groups/:groupId/role-assignments` if you've already loaded it) —
there is no dedicated capability-flag endpoint for a single Group today.

## Backend-enforced behavior worth knowing about

- **Archive/Unarchive/Read-Only/Activate/Transfer-Ownership/
  [Delete](#36-delete-community)/[Suspend](#39-suspend-member)/
  [Unsuspend](#40-unsuspend-member) return `201`, not `200`.** This is
  NestJS's default status for a `@Post()` handler with no explicit override
  — it is the actual, current backend behavior, not a documentation error.
  Do not branch on status code `200` for these calls; treat any `2xx` as
  success and read the body. [Ban](#37-ban-member)/[Unban Member](#38-unban-member)
  are the two exceptions among the new endpoints — both explicitly return
  `204 No Content` instead, matching [Remove Member](#15-remove-member).
- **A non-member gets `404`, never `403`, for any Group they can't see at
  all.** Don't treat `404` on `GET /groups/:id` as "deleted" without also
  considering "you're not a member (or no longer a member)."
- **`GET /groups/:groupId/role-assignments` (list and get-by-id) require
  the Group to be `ACTIVE`** — unlike almost every other read endpoint in
  this module, which works in any status. A `READ_ONLY` or `ARCHIVED`
  Group will return `409`, not the list, on this specific pair of
  endpoints.
- **`isHidden` never blocks joining** — only `isPublic` decides
  auto-join vs. join-request; `isHidden` only removes a Group from
  `GET /discovery/groups` search results.
- **`GET /groups/:groupId/audit-log` does not resolve `:groupId` to its
  Root Group** — unlike every permission check elsewhere in this module.
  Always pass the Organization's own id; see the endpoint's own
  [description](#41-list-audit-log) for what happens otherwise (an
  authorized-but-always-empty result, not an error).
- **Suspend/Unsuspend never end the Membership** — unlike Ban/Remove/Leave,
  a suspended Membership keeps every Role Assignment it holds; only its
  effective permissions shrink to the READ_ONLY-safe subset while
  suspended. Don't reuse "member removed" UI copy/flows for a suspension.
- **A suspension's `until` passing does not, by itself, immediately flip
  anything** — reconciliation back to `ACTIVE` happens lazily on the next
  request that resolves that Membership's authorization for any Group (see
  [Suspend Member](#39-suspend-member)). A client polling `GET /groups/:id/members/:membershipId`
  right at `until` may still see `READ_ONLY` for a moment.
- **Community Notification settings are the one set of endpoints in this
  module with no `GroupPermission` check at all** — only membership status.
  Every other write endpoint (including the other new ones — Delete, Ban,
  Suspend, Audit Log) follows the standard Role Assignment + Group-status
  gating described in [Permission rules](#permission-rules).

---

# Open items not determinable from the code

- Whether `GroupMembershipStatus.INVITED` will ever be produced by a future
  endpoint (today it is defined but dead — no code path sets it).
  `GroupMembershipResponseDto.status` can theoretically be typed as
  including it, but no test or code path exercises it.
- The exact ordering guarantee (or lack thereof) for `GET /groups/:id/children`,
  `GET /groups/:groupId/invitations`, `GET /groups/:groupId/join-requests`,
  and `GET /invitations` — the code has no explicit `orderBy`, so whatever
  order Postgres/MikroORM happens to return is what's documented above as
  "no explicit order"; this document does not guess a stable rule where the
  code doesn't guarantee one.
