# ADR-032: Standalone Sections

## Status

Accepted

## Context

[ADR-031](ADR-031-group-section-domain-rename.md) ("the organizational-domain
rebuild, stage 1") split Group and Section into two distinct, physically-stored
entity types. `Section.parentGroup` was modeled as nullable from that point on
- the entity itself has always been able to represent a Section with no
parent - but no API path ever produced one that way. The only endpoint that
creates a Section, `POST /groups/:groupId/sections`, requires a Group id in
the route; the sole way to reach "a Section that exists but has no parent"
was to create it under a Group and immediately detach it
(`DELETE /sections/:sectionId/parent`), a workaround, not a supported flow.

This left the domain model unable to serve a real use case: a user running
one or a few independent training groups with no interest in (or need for)
a wider organizational Group above them - they should not have to create and
maintain a Group they don't want, just to get a place to hold members and
trainings.

## Decision

A Section may exist independently with no parent Group. Group membership in
the hierarchy is optional and may be established or removed later without
affecting Section membership or role assignments.

Concretely:

- `POST /sections` creates a standalone Section (`parentGroup = null`),
  alongside the existing `POST /groups/:groupId/sections`, which is
  unchanged and continues to mean "create a Section under this exact Group".
  These are deliberately two separate endpoints, not one endpoint with an
  optional `parentGroupId` body field - the parent (or lack of one) is part
  of the endpoint's identity, not a parameter of a single generic "create a
  Section" operation.
- Creating a standalone Section requires no permission at all - any
  authenticated user may call `POST /sections`, mirroring `POST /groups`
  (see `GroupsService.create`). This is a deliberate consequence of Section
  having no parent to hold `SECTION_CREATE` against: that permission is,
  and remains, scoped to an existing parent community.
- The creator of a standalone Section receives exactly the same bootstrap
  as the creator of a Section created under a Group: an active
  `SectionMembership`, plus `MEMBER` and `OWNER` `RoleAssignment`s, created
  atomically with the Section itself. Both creation paths now share one
  implementation (`SectionsService`'s private `createInternal`) so this
  cannot drift between them.
- A standalone Section may later be attached to a Group (and detached again)
  through the hierarchy mechanism that already existed for this purpose
  before this ADR - `POST /sections/:sectionId/parent`,
  `DELETE /sections/:sectionId/parent`, and the `HierarchyInvitation`
  flow (`HierarchyManagementService`, `GroupHierarchyService`). None of
  that mechanism changes: attach/detach already never touched
  `SectionMembership` or `RoleAssignment` as a side effect (see
  `HierarchyManagementService`'s own comments), and multiple independent
  Sections belonging to the same user never gain any relationship to each
  other unless and until a Group is explicitly attached above them (see
  [ADR-019](ADR-019-no-automatic-relationships.md)).
- Creating a standalone Section never creates a Group, and never grants the
  creator any right over any Group. The two remain fully independent
  objects unless explicitly linked later.

## Consequences

- `SectionsService.create` (Section-under-Group) and the new
  `SectionsService.createStandalone` (parentless Section) share one
  transactional code path; the only difference between them is whether a
  parent Group is resolved and authorized first, and which entity an audit
  log entry for the creation is filed under (the parent Group for
  Section-under-Group, matching the pre-existing `CREATE_CHILD_GROUP`
  behavior; the Section itself for a standalone Section, matching how
  `GroupsService.create` already logs a new Group under itself with
  `CREATE_COMMUNITY`).
- `CommunityHomeCapabilitiesDto` gained `canCreateStandaloneSection: boolean`,
  a flat global boolean alongside `canCreateGroup`, not a community-id list -
  there is no existing community to key a list off of for this capability.
- Community Home, hierarchy attach/detach/invitations, and every other
  consumer of "a Section, addressed by id" needed no changes: they already
  handled a parentless Section correctly (see
  `GroupHierarchyService.resolveRootGroup` and
  `CommunityHomeService.resolveRootGroupId`, which already grouped a
  standalone Section under itself rather than failing).
