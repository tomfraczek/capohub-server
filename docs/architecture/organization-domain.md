---
title: Organization Domain
description: Domain Driven Design specification for CapoHub organizational module.
status: Draft
version: 1.1.0
last_updated: 2026-07-20
---

# Organization Domain

> This document defines the business architecture of the organizational
> module used by CapoHub. It is intentionally technology-agnostic and
> does not describe database implementation. The goal is to define
> business rules, relationships between entities, and architectural
> decisions that every implementation must follow.
>
> This document is part of a larger documentation set. See
> [docs/README.md](../README.md) for the full map, or jump directly to
> [organization-entities.md](organization-entities.md) for detailed
> per-entity rules, [organization-scenarios.md](organization-scenarios.md)
> for business scenarios, or [decisions/](../decisions/) for individual
> Architecture Decision Records.

---

# Table of Contents

- [Purpose](#purpose)
- [Design Principles](#design-principles)
- [Philosophy](#philosophy)
- [Glossary](#glossary)
- [Organization Model](#organization-model)
- [Group](#group)
- [Academy](#academy)
- [Section](#section)
- [Membership](#membership)
- [Roles](#roles)
- [Permissions](#permissions)
- [Invitations](#invitations)
- [Visibility Scope](#visibility-scope)
- [Hierarchy](#hierarchy)
- [Inheritance](#inheritance)
- [Cross Domain Principles](#cross-domain-principles)
- [Aggregate Overview](#aggregate-overview)
- [Dependency Rules](#dependency-rules)
- [Typical Business Flows](#typical-business-flows)
- [Future Extensions](#future-extensions)
- [Implementation Checklist](#implementation-checklist)
- [Open Questions](#open-questions)
- [Conclusion](#conclusion)

---

# Purpose

The purpose of this module is to model real Capoeira organizations as
faithfully as possible while remaining flexible enough to support
completely different organizational structures.

The module must support:

- independent schools,
- local groups,
- national organizations,
- international organizations,
- organizations with dozens of hierarchy levels,
- organizations without hierarchy,
- organizations with or without sections.

The system must never force a particular organizational model.

---

# Design Principles

The organizational module is built around several core principles. Two
of them - **Business First** and **No Hidden Logic** - are universal
CapoHub-wide principles; see [product/vision.md](../product/vision.md)
for their full statement. The three principles below are specific to the
Organization Domain.

## Everything Is A Group

There is no dedicated Organization entity. Every organizational unit -
international organization, national organization, regional
organization, city, local school - is represented by the same entity:
Group. Their role depends only on their position inside the hierarchy.
See [ADR-001](../decisions/ADR-001-no-organization-entity.md).

## Unlimited Hierarchy

There is no artificial hierarchy depth. The following structure is
completely valid:

```text
World
└── Europe
    └── Poland
        └── Greater Poland
            └── Poznań
                └── North
                    └── Monday Group
```

Every level is represented by the same entity. See
[ADR-002](../decisions/ADR-002-unlimited-group-hierarchy.md).

## Sections Are Optional

Sections are an organizational convenience. They are never required.
Small groups should work exactly the same as large organizations. See
[ADR-003](../decisions/ADR-003-optional-sections.md).

---

# Philosophy

Every Capoeira organization has its own graduation system. Even
organizations with similar cord colors often differ in graduation order,
category names, instructor titles, color combinations, and promotion
rules. For this reason CapoHub never hardcodes any graduation logic -
instead every Root Group owns its own Graduation System.

See [product/vision.md](../product/vision.md) for this principle's place
among CapoHub's universal philosophy, and
[ADR-005](../decisions/ADR-005-root-group-graduation-system.md) for the
resulting architectural decision.

---

# Glossary

See [product/glossary.md](../product/glossary.md) for the full,
alphabetized glossary of terms used throughout this document set.

---

# Organization Model

The entire organizational model is intentionally simple. Only three
business entities define the organizational structure: **Group**,
**Academy**, and **Section**. Everything else is attached to them.

See [organization-model.mmd](../diagrams/organization-model.mmd) for the
model diagram.

---

# Group

Group is the central entity of the entire CapoHub ecosystem. Every
organization, school, city, region, or local community is represented by
Group - the application does not distinguish between different "types"
of organizations; it relies entirely on hierarchy. Examples: `Capoeira
Brasil`, `Capoeira Brasil Poland`, `Capoeira Brasil Poznań`, `Capoeira
Brasil Poznań - North`, `Capoeira Brasil Poznań - Kids`. No special
entity exists for any of them.

A Group is responsible for members, administrators, permissions,
academies, sections, announcements, trainings, fees, media, gallery,
history, description, and settings. Every Group owns its own identity
regardless of hierarchy (name, logo, description, history, cover image,
contact information) - a child Group is not merely a folder.

For full business rules, relationships, lifecycle, and validation rules,
see [Group](organization-entities.md#group) in organization-entities.md.

---

# Academy

Academy represents a physical location where trainings take place.
Academy is **not** an organizational unit - it cannot have members,
Sections, permissions, administrators, roles, or child academies; it is
simply a place. Academy is a reusable **location template**: when creating
a training day or event, an organizer either picks an existing Academy as
the location or types a one-off location by hand. No user or Membership
is ever assigned to an Academy, in any capacity. An Academy always belongs
to exactly one Group. See
[ADR-012](../decisions/ADR-012-academy-not-organizational-unit.md).

For full business rules, relationships, lifecycle, and validation rules,
see [Academy](organization-entities.md#academy) in
organization-entities.md.

---

# Section

Section divides members inside one Group. Section is optional and exists
only to simplify management; CapoHub never assigns any meaning to
Section names. Groups are never required to create Sections - if a Group
contains zero Sections, trainings, announcements, and members simply
belong directly to the Group, and nothing changes in application
behavior. See [ADR-003](../decisions/ADR-003-optional-sections.md).

For full business rules, relationships, lifecycle, and validation rules,
see [Section](organization-entities.md#section) in
organization-entities.md.

---

# Membership

Membership represents a User's relationship with an organization - a
Root Group. A User does not "belong" to an organization directly -
instead a User belongs to one or more Root Groups, which naturally
supports multi-organization memberships. Membership always references
the Root Group itself, never a Child Group, Academy, or Section - while
active, that same Membership may additionally be assigned to zero or
more Sections belonging to the same Root Group (see [Section](#section));
those assignments are never removed when the Membership later ends, but
they stop granting any active access once it does. Membership is the
source of truth for organizational participation, and is never inherited
through the Group hierarchy. See
[ADR-004](../decisions/ADR-004-no-membership-inheritance.md).

For full business rules, lifecycle (Invited / Active / ReadOnly /
Archived), and validation rules, see
[Membership](organization-entities.md#membership) in
organization-entities.md.

---

# Roles

Roles define responsibilities; Permissions define capabilities. These
concepts are intentionally separated - e.g. `Instructor` is a Role, while
the ability to edit trainings is a Permission. One does not automatically
imply the other.

Roles are a **fixed, system-wide enum** defined by CapoHub - e.g. `Owner`,
`Admin`, `Instructor`, `Member`. Organizations and users cannot create
custom Roles, cannot edit what a Role grants, and cannot define their own
Permission sets; there is no Role or Permission editor. Extending the set
of system Roles or Permissions is a CapoHub code change plus a migration,
never a configuration action available at runtime. See
[ADR-028](../decisions/ADR-028-role-assignment-model.md).

A Role is granted through a **Role Assignment** - a record entirely
independent of Membership; Membership never stores a Role. Every Role
Assignment references one Membership, one Group (Root or Child), and one
system Role. A Membership may have at most one active Role Assignment per
Group - a higher Role always carries a broader Permission set than a
lower one within the same Group, so there is never a need to hold more
than one Role there at once - but the same Membership may hold Role
Assignments in multiple different Groups simultaneously, one Role each
(e.g. `Admin` of one Child Group and, separately, `Instructor` of
another). See
[RoleAssignment](organization-entities.md#roleassignment) for the full
entity reference.

---

# Permissions

Permissions define what a user can do; they never describe who someone
is. Examples: Create Trainings, Edit Trainings, Delete Trainings, Manage
Members, Manage Fees, Manage Events, Manage Sections, Manage
Announcements. Permissions are always explicit, and are a fixed,
system-wide enum - see [Roles](#roles) and
[ADR-028](../decisions/ADR-028-role-assignment-model.md). There is no
mechanism to assign a Permission directly, independently of a Role - a
caller's Permissions for a Group are entirely determined by the single
Role Assignment they hold for that Group. Permissions are always
evaluated at runtime - no permission snapshots should exist, which
guarantees immediate effect after Role changes.

## Business Rules

Permissions never inherit through Group hierarchy. Example: an
Administrator of `Poland` does **not** automatically become administrator
of `Poznań`. Every Group manages its own permissions independently, which
avoids accidental privilege escalation. See
[ADR-013](../decisions/ADR-013-no-permission-inheritance.md).

Role Assignment is a separate concept from Membership: Membership only
answers "does this User belong to this organization" and always
references the Root Group (see [Membership](#membership)), and never
stores a Role. A Role Assignment is granted directly for one specific
Group - Root or Child - and grants authority only there; every Role
Assignment requires the User to hold an active Membership in that Group's
Root Group, and expires logically the moment that Membership is no longer
`ACTIVE`. A Root Group administrator's authority covers the Root Group
itself and the organization-wide Graduation System, not the rest of the
tree; a Child Group is managed by whoever holds a Role Assignment directly
for that Child Group. Academy and Section have no Role Assignment or
Membership of their own - operations on them are authorized against the
Role Assignment the caller holds for the Group that owns them. See
[ADR-013](../decisions/ADR-013-no-permission-inheritance.md) and
[ADR-028](../decisions/ADR-028-role-assignment-model.md).

A Membership may have at most one **active** Role Assignment per Group -
never several Roles at once in the same Group, since a higher Role always
carries a broader Permission set than a lower one there. The same
Membership may still hold Role Assignments in several different Groups
simultaneously, one Role per Group. A guard authorizing an action on a
Group resolves Permissions from that single Role Assignment held directly
for the acted-on Group - never from a Role held in a different Group, and
never by combining Roles.

---

# Invitations

Invitations allow users to join Groups safely; searching users globally
by name is intentionally avoided. Supported methods: invitation link,
invitation code, QR code, email invitation. Organizations may disable
individual invitation methods.

For full business rules, lifecycle, and validation rules, see
[Invitation](organization-entities.md#invitation) in
organization-entities.md.

---

# Visibility Scope

Many CapoHub modules publish information to other users (announcements,
events, polls, tasks, media, documents, notifications). Instead of every
module implementing its own visibility logic, CapoHub defines a shared
concept called **Visibility Scope** that every module exposing content to
users should use.

## Visibility Levels

Visibility is always explicit - nothing is inherited automatically, and
the creator always decides who should receive the content.

- **Current Group** - visible only inside the Group where it was created.
  Example: an announcement created in `Poland` is visible only to members
  of `Poland`; child Groups do not receive it.
- **Entire Subtree** - visible to the current Group and every descendant
  Group. Example: an announcement created in `Poland` (with descendants
  `Poznań`, `Kraków`) is visible to Poland, Poznań, and Kraków, but not to
  `Germany` or `World`.
- **Selected Groups** - the author explicitly chooses which Groups (e.g.
  `Poznań` and `Konin`, while `Kraków` is intentionally excluded).
- **Selected Sections** - visibility limited to specific Sections within
  one Group (e.g. only `Kids` within `Poznań`).
- **Individual Users** - future modules may additionally support
  selecting individual users; intentionally excluded from the
  Organization Domain for now.

## Visibility Resolution

Visibility is always calculated dynamically; the application never
stores duplicated recipients. Resolution flows: Announcement → Visibility
Scope → Resolve Groups → Resolve Sections → Resolve Members → Deliver.
This guarantees that Membership changes are immediately respected.

Whenever visibility references a Group hierarchy, descendants are
resolved dynamically through Group traversal only - no Membership
inheritance occurs. Sections never participate in hierarchy traversal - a
Section always belongs to exactly one Group, and selecting one Section
never automatically includes sibling Sections or the entire Group.

## Business Rules

- Visibility never changes Membership.
- Visibility never grants permissions.
- Visibility never creates relationships.
- Visibility only determines who may access a resource.

See [ADR-008](../decisions/ADR-008-visibility-scope.md).

---

# Hierarchy

Groups may form hierarchical organizational structures representing
real-world relationships between organizations (international, national,
regional, and local). Hierarchy is represented exclusively through the
`parentGroup` relationship - no additional hierarchy entities exist.
Every node in the hierarchy is the same entity: **Group**; the hierarchy
is purely structural.

See [group-hierarchy-example.mmd](../diagrams/group-hierarchy-example.mmd)
for an example hierarchy diagram.

- **Root Group** - a Group without a parent; the highest level within an
  organization. Each hierarchy has exactly one Root Group.
- **Child Group** - any Group that has a parent. No functional difference
  exists between Root and Child Groups; the difference comes only from
  their position inside the hierarchy.

## Hierarchy Rules

- **Unlimited depth** - CapoHub never limits hierarchy depth.
- **No cycles** - hierarchy must always remain a tree; `GroupHierarchyService`
  guards against cyclic data whenever it resolves a Root Group or walks
  ancestors/descendants.
- **One parent** - a Group may have only one parent: zero parents, or
  exactly one, never more.
- **Independent identity** - every Group owns its own identity (members,
  administrators, permissions, academies, sections, announcements,
  settings); hierarchy does not merge Groups together.
- **`parentGroupId` is immutable** - a Group's parent is set once, at
  creation, and can never change afterward. There is no operation that
  attaches, detaches, or moves an existing Group to a different parent -
  not even within the same Root Group's tree. A Group's position in the
  hierarchy, and therefore its Root Group, is permanent for its entire
  lifetime.
- **Root Group never changes** - every Group belongs to exactly one Root
  Group for its entire lifetime, fixed at creation, as a direct
  consequence of `parentGroupId` immutability. A Root Group can never be
  given a parent, since doing so would change the Root Group of
  everything beneath it. Changing which organization a member belongs to
  happens exclusively through Membership - ending the Membership in the
  old Root Group and creating a new Membership in the new Root Group -
  never by re-parenting a Group. See
  [ADR-002](../decisions/ADR-002-unlimited-group-hierarchy.md).

## Group Hierarchy Service

All hierarchy logic is owned by a dedicated domain service,
`GroupHierarchyService`. Direct manipulation of `parentGroupId` is
forbidden. The service is responsible for validating a candidate parent
at creation time (existence, archived status), resolving a Group's Root
Group, walking ancestors, and walking descendants.

- **Attach Child Group (creation only)** - the parent must exist and must
  not be archived; the child's `parentGroupId` is set once, at creation
  time, and never changes again. Since the child does not yet exist when
  its parent is chosen, no cycle can be introduced.

See [ADR-002](../decisions/ADR-002-unlimited-group-hierarchy.md).

---

# Inheritance

Some Group properties may inherit from parent Groups. Inheritance is
dynamic - no values are copied. Current version supports inheritance for
logo, cover image, description, and history; future versions may extend
this list.

## Inheritance Modes

Every inheritable property contains one of three modes:

- **OWN** - the Group provides its own value; inheritance stops.
- **INHERITED** - the value is taken from the nearest ancestor that
  provides OWN.
- **EMPTY** - the Group intentionally displays nothing; inheritance does
  not continue. Without EMPTY it would be impossible to intentionally
  remove inherited content (e.g. a local Group deciding not to display
  the World organization's long history).

### Identity Inheritance Example

```text
Capoeira Brasil: Logo, History, Description (all OWN)
↓
Poland: Logo (INHERITED), History (INHERITED), Description (OWN)
↓
Poznań: Logo (INHERITED), History (OWN), Description (INHERITED)
```

Result - Poznań displays: Logo from Capoeira Brasil, History from
Poznań itself, Description from Poland. Every property is resolved
independently.

See [ADR-006](../decisions/ADR-006-dynamic-inheritance.md).

---

# Cross Domain Principles

This chapter defines architectural principles shared by all CapoHub
modules - not specific to Organization. Every future domain (Events,
Music, Knowledge Base, Payments, etc.) must follow them.

## Ownership

Every business object must have exactly one owner, determining who
manages it, where permissions are evaluated, where it appears, and which
hierarchy rules apply. Objects never belong to multiple Groups. See
[ADR-017](../decisions/ADR-017-single-owner-per-object.md) for the full
ownership table.

## Source of Truth

Every piece of information has exactly one source of truth; derived
values (Current Graduation, Member Count, Children Count) must never
become independent sources. The application may cache values for
performance, but the cache must never become authoritative. See
[ADR-018](../decisions/ADR-018-single-source-of-truth.md).

## Immutable History

Historical information should be preserved whenever possible. Instead of
deleting history, the system archives it (Membership, Graduations,
Invitations, Groups, Sections), which allows rebuilding historical state
at any point.

## Auditability

Important business operations should always be traceable (graduation
changes, hierarchy changes, permission changes, administrator changes). A
future Audit module should be capable of reconstructing who performed an
action, when, why, the previous state, and the new state.

## Explicit Relationships

CapoHub never creates relationships automatically - e.g. a newly created
User is never auto-linked to a matching text reference; an administrator
must explicitly link the User. The application never guesses. See
[ADR-019](../decisions/ADR-019-no-automatic-relationships.md).

## Dynamic Resolution

Relationships are resolved dynamically whenever possible instead of being
duplicated: Current Group logo through inheritance, announcement
recipients through hierarchy, Current Graduation from Graduation History.
No duplicated data should be stored if it can be resolved safely.

## Reference Integrity

Removing one object must never destroy another - e.g. deleting a User
must not erase graduation history, announcements, hierarchy, or
organization history; instead references become historical. Archived
objects remain valid references (historical graduations still reference
an archived Group; nothing breaks).

## Stable Identifiers

Every entity owns an immutable identifier that never changes, while
human-readable values (e.g. a Group's display name) may change freely.
Public Codes are a related but distinct concept - user-facing, not
database identifiers, used in invitation links, QR codes, printed
certificates, and event registration. See
[ADR-022](../decisions/ADR-022-immutable-identifiers.md) and
[ADR-023](../decisions/ADR-023-stable-public-codes.md).

## User References

Whenever a User is referenced by another entity, Identity (User ID) and
Presentation (Display Name) are kept separate - the system should never
depend on current display names, so historical information remains
readable.

### Future Person Domain

The current version intentionally avoids introducing a Person entity;
references to people outside CapoHub are stored as plain text
(`displayName` plus optional `linkedUserId`). Future versions may
introduce a dedicated Person Domain; migration must remain possible
without breaking existing data.

## Time

Every business entity should store timestamps consistently: at minimum
`createdAt` and `updatedAt`; historical entities additionally store
`effectiveFrom` / `effectiveTo` when applicable.

### Business Time

Business dates differ from system dates - e.g. a promotion's *achieved*
date (`2022-05-15`) differs from its *recorded* date (`2026-02-11`). Both
values are important.

## Transactions

Complex business operations should be transactional (Batch Promotion,
Moving a Group) - partial execution is unacceptable. See
[ADR-021](../decisions/ADR-021-transactional-operations.md).

## Domain Services

Complex business logic belongs to dedicated Domain Services
(`GroupHierarchyService`, `GraduationService`, `MembershipService`,
`InvitationService`); entities remain focused on business state. See
[ADR-020](../decisions/ADR-020-domain-services-for-complex-logic.md).

---

# Aggregate Overview

The Organization Domain consists of three independent Aggregates. Full
entity-level responsibilities are documented in
[organization-entities.md](organization-entities.md); this section
summarizes the boundaries between them.

See [entity-overview.mmd](../diagrams/entity-overview.mmd) for the
complete entity-relationship diagram.

## Group Aggregate

Aggregate Root: `Group`. Contains: Academy, Section, Membership,
RoleAssignment, Invitations. Responsible for organizational hierarchy,
members, permissions, sections, and academies.

## Graduation Aggregate

Aggregate Root: `GraduationSystem`. Contains: GraduationCategory,
GraduationLevel. Responsible for graduation definition, ordering,
categories, and colors. Every Root Group has exactly one
`GraduationSystem` - the relationship is mandatory (1:1).

## User Graduation Aggregate

Aggregate Root: `UserCurrentGraduation`. Contains: UserGraduationEntry.
Responsible for current graduation and graduation history.
`UserCurrentGraduation` is a 0..1 relationship per (User, Root Group) -
it does not exist until the member's Initial Assignment is recorded.

## Aggregate Boundaries

The Group Aggregate never edits the Graduation Aggregate. The Graduation
Aggregate never edits Membership. Membership never edits Group hierarchy.
Every aggregate owns its own consistency; cross-aggregate communication
occurs through Domain Services. See
[ADR-026](../decisions/ADR-026-aggregates-communicate-through-services.md).

## Domain Events

The Organization Domain should emit business events, which future
modules may subscribe to: `GroupCreated`, `GroupArchived`,
`MembershipCreated`, `MembershipArchived`, `RoleAssigned`, `RoleRevoked`,
`GraduationAssigned`, `GraduationCorrected`, `GroupMoved`.

## Read Models

Some frequently accessed data should exist as optimized read models:
Current Graduation (`UserCurrentGraduation`), current Member Count,
current Section Count, and current Academy Count (all cached
projections). Read models never become the source of truth. See
[ADR-027](../decisions/ADR-027-read-models-not-authoritative.md).

## Performance

Business correctness has higher priority than optimization - optimization
should only happen after correctness. When optimization is necessary,
projections, caches, and read models may be introduced, but business
rules remain unchanged.

---

# Dependency Rules

The Organization Domain should not depend on Events, Payments, Music,
Knowledge, Chat, or Notifications. Instead, those modules depend on
Organization - this keeps the Organization Domain stable. See
[ADR-024](../decisions/ADR-024-organization-domain-independence.md).

Organization Domain is responsible only for: organizational hierarchy,
members, permissions, graduation, academies, and sections. Everything
else belongs elsewhere. Only business entities belong inside this Domain;
presentation concerns are excluded. See
[ADR-025](../decisions/ADR-025-business-entities-only.md).

## Out of Scope

The following modules intentionally do not belong to the Organization
Domain. They reference the organizational structure but define their own
business rules:

- Events
- Attendance
- Music
- Knowledge Base
- Payments
- Notifications
- Tasks
- Chat
- Media Library
- Genealogy
- Certificates
- Exams

The Organization Domain intentionally does NOT solve training scheduling,
attendance, event registration, payment collection, chat, genealogy,
music management, or media management - those concerns belong to
separate domains.

> **TODO (documentation inconsistency):** the source document listed
> "modules out of scope" four separate times (as "Future Modules", "Out
> of Scope", "Non-Goals", and "Open Questions"), each with a slightly
> different membership (e.g. "Exams" appeared only once, "Certificates"
> and "Genealogy" appeared in some lists but not others). The list above
> is the union of all four. No architectural decision seems to hinge on
> the differences, but if a specific module's exclusion was deliberately
> narrower in one place, please confirm and adjust.

---

# Typical Business Flows

## Creating Organization

Administrator → Creates Root Group → Configures Graduation System →
Creates child Groups → Creates Academies → Creates Sections → Invites
Members.

## Member Joins

Invitation → Membership → Optional Section assignment → Normal
participation.

## Promotion

Instructor → Selects Graduation → Creates Graduation Entry → Updates
Current Graduation → History preserved. This flow describes a
**subsequent** grant; a member's first grant within an organization is an
Initial Assignment instead (see
[ADR-011](../decisions/ADR-011-graduation-order-validation.md#initial-assignment)),
which creates the Current Graduation for the first time rather than
updating an existing one.

## Organization Expansion

Create Child Group → Assign Administrators → Create Academy → Create
Sections → Invite Members.

No data duplication occurs in any of these flows. See
[organization-scenarios.md](organization-scenarios.md) for the full,
detailed business scenarios these flows summarize.

---

# Future Extensions

The Organization Domain has been intentionally designed to support future
growth. The following features are expected to integrate directly with
this model:

- **Events** - will reference Group, Academy, Sections, and Visibility
  Scope. Future versions of Graduation History will additionally
  reference Events (e.g. a `GraduationEntry` referencing `Batizado
  2027`).
- **Certificates** - may reference User, Graduation, Organization, and
  Event. Certificate templates will belong to Graduation Systems.
- **Genealogy** - future versions may introduce a dedicated Person
  Domain; current text-based person references are fully compatible with
  future migration.
- **Rankings** - may aggregate attendance, graduations, and achievements
  without modifying the Organization Domain.
- **Statistics** - e.g. members per Group, members per Section,
  graduations per year, organization growth, instructor statistics - all
  derived from historical data.
- **Multi-language** - the Organization Domain supports localization;
  display names may be translated, while business identifiers remain
  unchanged.

Hierarchy inheritance itself may later extend to additional resources:
theme colors, organization branding, default notification settings,
document templates, and default graduation certificate templates. The
inheritance mechanism remains identical regardless of property type.

Future property inheritance and future person-domain migration are the
two explicitly anticipated extension points; both are designed to be
additive and non-breaking.

---

# Implementation Checklist

The following order is recommended for backend implementation:

1. **Phase 1** - Group, Academy, Section.
2. **Phase 2** - Membership, Roles, Permissions.
3. **Phase 3** - Invitations, QR Codes, Public Codes.
4. **Phase 4** - Group Hierarchy, GroupHierarchyService, Inheritance.
5. **Phase 5** - Graduation System, Graduation Categories, Graduation
   Levels.
6. **Phase 6** - Graduation History, Initial Assignment, Current
   Graduation, Batch Promotion.
7. **Phase 7** - Read Models, Visibility Resolution, Performance
   Optimization.
8. **Phase 8** - Audit Log, Administrative Override, Historical Import.

---

# Open Questions

The following topics are intentionally postponed and will receive
dedicated architectural documents: Event Domain, Attendance, Payments,
Genealogy, Certificates, Media, Music, Knowledge Base, Chat.

---

# Conclusion

The Organization Domain is the foundation of the CapoHub platform. It
intentionally focuses only on organizational structure and member
management. Every future module should integrate with this domain
instead of extending or replacing it.

This document set should be considered the authoritative business
specification for the Organization Domain. If implementation and
documentation differ, the documentation should be treated as
authoritative until intentionally revised.
