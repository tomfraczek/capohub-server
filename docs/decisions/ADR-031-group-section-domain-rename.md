# ADR-031: Group/Section Domain Rename

## Status

Accepted

## Context

The domain's public-facing vocabulary was confusing: what the product now
calls a "Group" (a top-level organizational unit - a school, a national
federation) was internally just a `Group` row with `parentGroup === null`
(informally "the Organization", per ADR-001 - there was never a separate
Organization entity). What the product now calls a "Section" (a nested unit
under a Group, at any depth - a city chapter, a training team) was
internally just a `Group` row with a parent. Product decided to rename this
public vocabulary to `Group` → `Section`, matching how organizations
actually talk about their own structure.

This collided with an existing, different entity already named `Section`:
a flat, non-hierarchical tag for grouping members within a Group (e.g.
"Kids", "Monday practice" - see the former ADR-003). That entity has no
relation to the hierarchy rename and had to be renamed out of the way first.

## Decision

**Terminology map:**

| Old name | New name |
|---|---|
| Organization / Root Group (informal - no entity) | **Group** |
| Group, specifically a Child Group (`parentGroup !== null`) | **Section** |
| Section (flat member tag, former ADR-003) | **Cohort** |
| `MembershipRequestTarget.ORGANIZATION` | `MembershipRequestTarget.GROUP` |
| `MembershipRequestTarget.GROUP` | `MembershipRequestTarget.SECTION` |
| `isOrganization` (discovery DTOs) | `isRootGroup` |
| `canCreateOrganization` (Community Home capability) | `canCreateGroup` |
| `canCreateGroupInCommunityIds` (Community Home capability) | `canCreateSectionInCommunityIds` |

**Structural decision: one entity, not two.** The underlying `Group` entity
(table `groups`) is *not* split into two physical tables. A row with
`parentGroup === null` is presented as a **Group**; any other row (at any
depth) is presented as a **Section**. This directly continues ADR-001's
philosophy one level down: there is no dedicated entity per hierarchy
level, only a computed discriminator. Consequences:

- No FK/column renames anywhere in the schema for the entity itself -
  `group_id`, `root_group_id`, `parent_group_id` and every dependent table
  (memberships, role_assignments, academies, audit_log_entries,
  community_notification_settings, events, cohorts) are untouched.
- Unlimited-depth nesting (ADR-002) is preserved unchanged: a Section can
  itself have child Sections, exactly as a Child Group could have further
  Child Groups before this rename. This was a deliberate choice over
  restricting to a flat 2-level Group→Section shape, since the latter would
  have been a real business-logic change (rejecting/collapsing existing
  hierarchy depth), not a pure rename.
- `GroupRole` is **not** renamed to `SectionRole`. Roles apply identically
  whether the acted-on entity is a Group or a Section (`RoleAssignment`
  already targeted either level before this rename, and
  `RoleAssignmentsController`'s own long-standing doc comment already
  described role management as level-agnostic) - renaming it would
  misrepresent roles as Section-only.
- API/route split: `GroupsController` (`/groups`) is now root-only -
  `POST /groups` no longer accepts a `parentGroupId` body field. A new
  `SectionsController`/`SectionController` pair
  (`/groups/:groupId/sections`, `/sections/:sectionId/sections`,
  `/sections/:sectionId`) handles Section creation/listing (dual-mounted,
  since a Section's parent may itself be a Group or another Section) and
  single-resource operations. A new `@RequireGroupKind(ROOT | SECTION)`
  guard decorator enforces that a Section id 404s on a Group-only route and
  vice versa, so the two id spaces never cross.
- Sub-resources that already worked at any hierarchy depth
  (`RoleAssignmentsController`, `AcademiesController`, the renamed
  `CohortsController`, `MembershipRequestsController`) are dual-mounted
  under both `/groups/:groupId/...` and `/sections/:sectionId/...`, backed
  by the same service, rather than duplicated.
- Two sub-resources that were silently root-resolving before this rename
  (`AuditLogController`, `CommunityNotificationSettingsService`) now
  explicitly reject a Section id (404) instead of silently operating on its
  ancestor Group - this is a small, deliberate behavior tightening: it
  turns an implicit assumption into an enforced invariant, without changing
  behavior for any caller that was already passing a Group id correctly.

**Database migration strategy.** Three migrations, all pure schema/value
renames with a real Postgres verification pass (never destructive):

1. `Migration20260728120000_RenameSectionsToCohorts` - table/column/
   constraint/index renames only (`sections`→`cohorts`,
   `membership_sections`→`membership_cohorts`, `section_id`→`cohort_id`).
   Zero data transformation, ids and rows fully preserved.
2. `Migration20260728130000_RenameMembershipRequestTargetValues` - the one
   real stored-data change: `membership_requests.target_type` literal
   values `'ORGANIZATION'`/`'GROUP'` become `'GROUP'`/`'SECTION'`. Since a
   naive two-step `UPDATE` would corrupt data (the second update would also
   match rows the first one just wrote), this rotates through a temporary
   sentinel value so each `UPDATE`'s `WHERE` clause only ever matches
   original, untouched values.
3. `Migration20260728140000_AddGroupCountryAndCity` - adds `country`/`city`
   (see below), both nullable, no fabricated backfill.

All three were applied to and verified against a real local Postgres
instance with pre-existing data (155 groups) - `up`/`down`/`up` cycles
confirmed byte-for-byte id/row preservation in both directions.

**New `country`/`city` fields.** Added to `groups` (nullable at the DB
layer - there is no safe value to backfill onto existing rows). `country`
is ISO 3166-1 alpha-2, format-checked at the DB layer (`CHECK` constraint)
and validated against the real code list in the application layer
(`src/common/validation/iso-3166-alpha2.ts`); `city` is free text.
"Required on create" is enforced only at the DTO layer, and asymmetrically
by level: `country` is **required** when creating a Section (a Section
operates in one place) but **optional** when creating a Group (a Group may
span multiple countries, e.g. an international federation) - `city` stays
optional on both. This asymmetry was an explicit product decision.

**New "Discover Community" search.** Replaces the old ad-hoc
`GET /discovery/groups?q=` (fixed limit 50, no pagination envelope, no
country/city/type filters) with `GET /discovery/search`
(`name`/`country`/`city`/`type` filters, all optional, `PaginatedResponse<T>`
envelope matching every other list endpoint in this codebase). At least one
of `name`/`country`/`city` is required - `type` alone does not satisfy this,
since there is deliberately no unfiltered "list everything" endpoint. This
surfaces as the same generic `{ code: 'VALIDATION_ERROR' }` shape as any
other Zod validation failure (via a schema-level `.refine()`), not a
bespoke error code, matching this codebase's existing convention. The
"All / Groups / Sections" tabs are built as three separate calls (omit
`type`, or pass `type=GROUP`/`type=SECTION`) rather than one call
pre-splitting results, since a single call cannot honor independent
pagination per sub-list under this codebase's `PaginatedResponse<T>`
contract.

## Consequences

- No backward-compatible route aliases were introduced. `/organizations/*`
  never existed as a shipped route (there is no separate Organization
  entity, so there was never such a route to alias), and there is no
  external client in this repository to preserve compatibility for.
- A modest amount of business logic is now duplicated between
  `GroupsService` and `SectionsService` (lifecycle-transition methods:
  archive/unarchive/setReadOnly/activate/delete, ~50 lines) rather than
  shared through a common base, since the two expose different response
  DTOs (`GroupResponseDto` has no `parentId`; `SectionResponseDto` does)
  through different route families with different kind-enforcement. This
  is a known, accepted trade-off given the size of this refactor; a future
  pass could extract the shared transition logic behind a common interface
  if the duplication becomes a maintenance problem.
- Everywhere the pre-rename vocabulary is still visible - historical
  migration files, and the large pre-existing architecture documents under
  `docs/architecture/organization-*.md` - is deliberate: migrations must
  never be rewritten (see ADR-007/ADR-022 on immutability), and the large
  architecture documents were left with a terminology-mapping note at the
  top rather than being rewritten line-by-line under this change, to keep
  this refactor's scope bounded to code + the highest-leverage docs
  (glossary, this ADR). A full prose rewrite of those documents is tracked
  as follow-up work, not done here.
