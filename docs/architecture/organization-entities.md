---
title: Organization Entities
description: Detailed entity reference for the Organization Domain - purpose, responsibilities, business rules, relationships, lifecycle, and validation rules for every entity.
status: Draft
version: 1.0.0
last_updated: 2026-07-20
---

# Organization Entities

> This document provides the detailed entity-level reference for the
> Organization Domain. For the high-level model, design principles, and
> cross-cutting concepts (Roles, Permissions, Visibility Scope,
> Hierarchy, Inheritance), see
> [organization-domain.md](organization-domain.md).

---

# Table of Contents

- [Group](#group)
- [Academy](#academy)
- [Section](#section)
- [Membership](#membership)
- [Invitation](#invitation)
- [GraduationSystem](#graduationsystem)
- [GraduationCategory](#graduationcategory)
- [GraduationLevel](#graduationlevel)
- [UserGraduationEntry](#usergraduationentry)
- [UserCurrentGraduation](#usercurrentgraduation)

---

# Group

## Purpose

Group is the central entity of the entire CapoHub ecosystem. Every
organization, school, city, region, or local community is represented by
Group. The application does not distinguish between different "types" of
organizations - it relies entirely on hierarchy. International
organizations, national organizations, regional organizations, cities, and
local schools are all Groups; their role depends only on their position
inside the hierarchy.

Examples: `Capoeira Brasil`, `Capoeira Brasil Poland`, `Capoeira Brasil
Poznań`, `Capoeira Brasil Poznań - North`, `Capoeira Brasil Poznań -
Kids`. No special entity exists for any of them.

## Responsibilities

A Group is responsible for:

- members
- administrators
- permissions
- academies
- sections
- announcements
- trainings
- fees
- media
- gallery
- history
- description
- settings

Future modules will also belong to Group.

Every Group owns its own identity regardless of hierarchy: name, logo,
description, history, cover image, and contact information. A child Group
is not merely a folder - it has its own members, administrators,
permissions, academies, sections, announcements, and settings. Hierarchy
does not merge Groups together (see
[Independent Identity](organization-domain.md#hierarchy-rules)).

## Business Rules

- A Group may exist without children.
- A Group may have unlimited children - no depth limit exists.
- The parent Group is optional (`parentGroupId?`). If empty, the Group
  becomes a Root Group.
- A Group may have only one parent (zero parents, or exactly one - never
  more).
- Hierarchy must always remain a tree - no cycles are permitted; every
  hierarchy operation must validate that none are introduced.
- Root Groups always own exactly one Graduation System (mandatory,
  created together with the Root Group - see
  [ADR-005](../decisions/ADR-005-root-group-graduation-system.md)), plus
  organization identity and the inheritable branding/history/description
  values used as the top of the inheritance chain.
- No functional difference exists between Root and Child Groups; the
  difference comes only from their position inside the hierarchy.
- `parentGroupId` is set once, at creation, and is immutable afterward -
  there is no attach, detach, or move operation. Parent validation at
  creation time is performed through `GroupHierarchyService`. Direct
  manipulation of `parentGroupId` is forbidden. See
  [ADR-002](../decisions/ADR-002-unlimited-group-hierarchy.md).
- Groups are never physically deleted; they become archived instead. See
  [ADR-007](../decisions/ADR-007-soft-delete.md).

### Some properties inherit from parent Groups

Logo, cover image, description, and history may inherit dynamically from
parent Groups using the OWN / INHERITED / EMPTY modes. See
[ADR-006](../decisions/ADR-006-dynamic-inheritance.md) and
[Inheritance](organization-domain.md#inheritance) for the full mechanism.

## Relationships

- A Group may have zero or one parent Group (`parentGroup`).
- A Group may have zero or more child Groups.
- A Group may own zero or more Academies (an Academy belongs to exactly
  one Group).
- A Group may own zero or more Sections (a Section belongs to exactly one
  Group).
- A Group has zero or more Memberships (Users participating in the
  Group).
- Only a Root Group owns a GraduationSystem, and it always owns exactly
  one (mandatory, 1:1); every descendant Group uses the Root Group's
  system instead of owning its own.

## Lifecycle

`GroupHierarchyService` validates the parent at creation time - the
parent must exist and must not be archived. Once created, a Group's
`parentGroupId` never changes: there is no attach, detach, or move
operation. A Group's position in the hierarchy, and therefore its Root
Group, is fixed for its entire lifetime.

### Archival (soft delete)

Groups are never physically deleted - instead they become archived, to
avoid destroying references from memberships, graduations,
announcements, media, trainings, attendance, and history.

Archived Groups:

- cannot receive new members,
- cannot create new trainings,
- cannot create new announcements,
- remain visible in historical data.

Applications may hide archived Groups by default. Archived Groups remain
valid references - historical graduations and other records still
reference an archived Group, and nothing breaks.

## Validation Rules

- `parentGroupId` is set only at creation, through `GroupHierarchyService`,
  and never changes afterward.
- A Group may have at most one parent at any time.
- The chosen parent must exist and must not be archived.

---

# Academy

## Purpose

Academy represents a physical location where trainings take place.
Academy is **not** an organizational unit - it cannot have members,
permissions, administrators, or child academies. It is simply a place.
See [ADR-012](../decisions/ADR-012-academy-not-organizational-unit.md).

Example:

```text
Capoeira Brasil Poznań

├── Academy - City Center
├── Academy - Grunwald
└── Academy - Rataje
```

## Responsibilities

Academy stores:

- name
- address
- coordinates
- contact information
- opening hours
- photos
- description

## Business Rules

- An Academy always belongs to exactly one Group.
- It cannot belong to multiple Groups.
- It cannot exist independently.
- An Academy cannot have members, permissions, administrators, or child
  academies.

## Relationships

- Academy belongs to exactly one Group (owner).

## Lifecycle

Academy participates in the same soft-delete policy as Group, Section,
Membership, and Invitation - it is archived rather than physically
deleted. See [ADR-007](../decisions/ADR-007-soft-delete.md).

## Validation Rules

- Academy must reference exactly one existing Group at creation and at
  all times.

---

# Section

## Purpose

Section divides members inside one Group. Section is optional and exists
only to simplify management. CapoHub never assigns any meaning to Section
names - their purpose is defined entirely by the organization. See
[ADR-003](../decisions/ADR-003-optional-sections.md).

Examples: `Kids`, `Adults`, `Beginners`, `Advanced`, `Monday`,
`Wednesday`, `Performance Team`.

## Responsibilities

A Section organizes a subset of a Group's members for management
convenience (e.g. scheduling, communication) without being a distinct
organizational unit.

## Business Rules

- A Section belongs to exactly one Group.
- A Section cannot contain child Sections.
- A Section cannot own Academies.
- A Section cannot own Groups.
- A Section cannot exist without a Group.
- Section membership requires an active Group Membership - a user cannot
  belong to a Section without belonging to its parent Group.
- Membership inside a Section is optional: a user may belong to zero, one,
  or multiple Sections, depending entirely on the organization's
  structure. A single member may belong to multiple Sections
  simultaneously (e.g. both `Adults` and `Performance Team`); CapoHub does
  not restrict this.

### Groups Without Sections

Groups are never required to create Sections. If a Group contains zero
Sections: trainings belong directly to the Group, announcements belong
directly to the Group, and members belong directly to the Group. Nothing
changes in application behavior. This allows even very small schools to
use the platform without unnecessary complexity.

## Relationships

- Section belongs to exactly one Group.
- Section has zero or more Section Memberships, each requiring an
  underlying active Group Membership for the same user.

## Lifecycle

Section participates in the same soft-delete policy as Group, Academy,
Membership, and Invitation. See
[ADR-007](../decisions/ADR-007-soft-delete.md).

## Validation Rules

- A Section-membership operation must reject users without an active
  Membership in the Section's parent Group.

---

# Membership

## Purpose

Membership represents a User's relationship with a Group. A User does not
"belong" to an organization directly - instead a User belongs to one or
more Groups. This design allows complete flexibility and naturally
supports multi-organization memberships (e.g. a user in `Capoeira Brasil >
Poznań` and, independently, in `Muzenza > Wrocław`). CapoHub never assumes
that a User belongs to only one organization.

## Responsibilities

Membership stores all information describing a user's participation in a
Group and is the source of truth for organizational participation,
including:

- join date
- leave date
- current status
- nickname inside the Group
- permissions
- roles
- graduation
- instructor assignments
- internal notes

## Business Rules

- Membership is never inherited through the Group hierarchy - it exists
  only within the Group it was created for. See
  [ADR-004](../decisions/ADR-004-no-membership-inheritance.md).
- A User may have only one **active** Membership per Group at a time.
  Historical (archived) memberships for the same Group/user pair may
  exist, allowing a user to leave and later return to the same Group
  without losing history (e.g. `2018-2020 ACTIVE`, `2020-2022 ARCHIVED`,
  `2024- ACTIVE`).
- Memberships are never physically deleted; removing a member archives
  the Membership, guaranteeing complete historical integrity. See
  [ADR-007](../decisions/ADR-007-soft-delete.md).
- A Membership may contain multiple Roles (e.g. `Instructor` +
  `Treasurer` simultaneously).
- Permissions may be granted through Roles or direct assignment; direct
  permissions always override inherited Role permissions. Permissions
  never inherit through the Group hierarchy - see
  [ADR-013](../decisions/ADR-013-no-permission-inheritance.md).

## Relationships

- Membership belongs to exactly one User and exactly one Group.
- Membership may reference zero or more Section Memberships (see
  [Section](#section)).
- Membership may carry one or more Roles and zero or more direct
  Permissions.

## Lifecycle

See [membership-lifecycle.mmd](../diagrams/membership-lifecycle.mmd) for
the full state diagram (`Invited → Active ⇄ ReadOnly → Archived`).

Statuses:

- **INVITED** - an invitation has been created; the user has not accepted
  it yet; the Membership is not active.
- **ACTIVE** - normal state; the user participates fully in the Group.
- **READ_ONLY** - Membership remains visible and historical data remains
  available, but the user loses operational permissions (e.g. suspended
  member, temporary break, inactive instructor).
- **ARCHIVED** - historical membership; the user no longer belongs to the
  Group; nothing is deleted and historical information remains available.

## Validation Rules

- Only one Membership per (User, Group) pair may be `ACTIVE` at a time.
- Section Membership requires an existing active Group Membership for the
  same user and Group.

---

# Invitation

## Purpose

Invitations allow users to join Groups safely. Searching users globally
by name is intentionally avoided.

## Responsibilities

An Invitation carries the information needed for a user to join a
specific Group through one of the supported methods:

- invitation link
- invitation code
- QR code
- email invitation

Organizations may disable individual invitation methods.

## Business Rules

- An invitation belongs to exactly one Group.
- Accepting an invitation creates one Membership.
- Expired invitations cannot be accepted.
- Revoked invitations cannot be accepted.
- Membership activation always requires explicit user action.
- Invitations (like Group, Academy, Section, and Membership) are
  soft-deleted rather than physically removed. See
  [ADR-007](../decisions/ADR-007-soft-delete.md).

## Relationships

- Invitation belongs to exactly one Group.
- Accepting an Invitation produces exactly one Membership.

## Lifecycle

See [invitation-flow.mmd](../diagrams/invitation-flow.mmd) for the full
flow diagram (Admin creates an invitation via Link/QR/Code; User accepts
it, producing a Membership).

## Validation Rules

- An Invitation must reference exactly one existing Group.
- Acceptance must be rejected if the Invitation is expired or revoked.

### Public Codes

Every important object (Group, Academy, User, and by extension
Invitation-related links) may expose a public identifier intended for QR
codes and invitation links. Public codes are never database identifiers
and are immutable once generated. See
[ADR-023](../decisions/ADR-023-stable-public-codes.md).

---

# GraduationSystem

## Purpose

GraduationSystem defines every graduation available inside one
organization. There is exactly one Graduation System per Root Group.
CapoHub does not assume the number of cords, cord colors, graduation
names, instructor titles, category names, or graduation order - everything
is configurable by the organization. See
[ADR-005](../decisions/ADR-005-root-group-graduation-system.md).

Example:

```text
Capoeira Brasil

Graduation System

├── Aluno
├── Graduado
├── Instrutor
├── Professor
├── Contra-Mestre
└── Mestre
```

Another organization may define something completely different (e.g.
`Student`, `Teacher`, `Master`). CapoHub supports both equally.

## Responsibilities

GraduationSystem stores:

- organization-specific graduation rules
- graduation categories
- graduation levels
- graduation ordering
- graduation colors
- certificate templates (future)
- promotion rules (future)

## Business Rules

- Graduation Systems belong exclusively to Root Groups.
- A Root Group always has exactly one Graduation System; the
  relationship is mandatory (1:1), not optional. See
  [ADR-005](../decisions/ADR-005-root-group-graduation-system.md).
- A Child Group cannot create one, cannot edit one, and cannot replace
  one - it always inherits the Root Group's system.
- Every descendant Group automatically uses the Root Group's system.

## Relationships

- GraduationSystem belongs to exactly one Root Group (Aggregate Root of
  the Graduation Aggregate), and every Root Group has exactly one
  GraduationSystem.
- GraduationSystem contains one or more GraduationCategory records, each
  containing one or more GraduationLevel records.

## Lifecycle

A GraduationSystem is created together with its Root Group - the two are
created atomically, since the relationship is mandatory. It subsequently
evolves only through changes to its Categories and Levels; it is never
replaced wholesale by a descendant Group.

## Validation Rules

- Only a Root Group may be the owner of a GraduationSystem.
- A Root Group must not exist without a GraduationSystem.
- A Child Group's attempt to create, edit, or replace a GraduationSystem
  must be rejected.

---

# GraduationCategory

## Purpose

A Graduation Category groups multiple graduation levels so the
application can understand that several cords belong to the same stage of
development, instead of presenting a flat, semantically meaningless list
of levels. Examples: `Aluno`, `Graduado`, `Instrutor`, `Professor`. These
names are configurable, not hardcoded.

## Responsibilities

A category defines:

- display name
- display order
- description
- icon (future)
- visibility

It does **not** define individual cords - those belong to Graduation
Levels.

## Business Rules

- Category ordering is explicit; CapoHub never assumes that, e.g.,
  `Instrutor` comes before `Professor` - organizations define everything.

## Relationships

- GraduationCategory belongs to exactly one GraduationSystem.
- GraduationCategory contains one or more GraduationLevel records.

## Lifecycle

Categories are created and reordered by the owning Root Group as part of
managing its GraduationSystem.

## Validation Rules

- Category display order must be explicit and organization-defined; it is
  never derived automatically.

---

# GraduationLevel

## Purpose

GraduationLevel represents a single achievable graduation (e.g. `Yellow`,
`Yellow / Blue`, `Blue`, `Blue / Green`). Each level belongs to exactly
one Graduation Category.

## Responsibilities

A Graduation Level stores:

- name
- display order
- belt colors
- optional description
- optional abbreviation
- visibility

Future versions may additionally store SVG belt rendering, graduation
requirements, required training hours, required attendance, minimum age,
or recommended preparation period. Those rules are intentionally excluded
from Version 1.

## Business Rules

- Ordering is defined explicitly; CapoHub never derives ordering from
  belt colors.
- Every Graduation Level stores one or more colors (e.g. `Yellow`,
  `Yellow + Blue`, `Blue + Green`). The rendering mechanism belongs to the
  UI layer - the domain stores only structured color definitions.
- Graduation order is enforced by the system for every promotion;
  organizations cannot disable graduation validation. The only
  exceptions are Initial Assignment (a member's first entry, which has
  no prior order to validate against), Administrative Override, and
  Historical Import. See
  [ADR-011](../decisions/ADR-011-graduation-order-validation.md).

## Relationships

- GraduationLevel belongs to exactly one GraduationCategory.
- GraduationLevel is referenced by zero or more UserGraduationEntry
  records.

## Lifecycle

Levels are created and reordered by the owning Root Group as part of
managing its GraduationSystem.

## Validation Rules

- Display order must be explicit and organization-defined.
- Promotions referencing a GraduationLevel are validated against
  graduation-order rules (see [ADR-011](../decisions/ADR-011-graduation-order-validation.md)),
  unless created via Initial Assignment, Administrative Override, or
  Historical Import.

---

# UserGraduationEntry

## Purpose

UserGraduationEntry is a historical promotion - an immutable business
event representing "User received Graduation X". A graduation is not
simply a value assigned to a User; it represents a historical event in
the member's Capoeira journey. CapoHub treats every promotion as an
immutable historical record, and Graduation History is the source of
truth (see [ADR-009](../decisions/ADR-009-graduation-history-source-of-truth.md)).

## Responsibilities

Each historical entry stores:

- user
- Root Group
- Group where promotion occurred
- Graduation Level
- Graduation Category
- achievedAt
- createdAt
- updatedAt
- optional note
- optional awardedByUser
- optional awardedByName

Future versions additionally support Event reference, Certificate,
Photos, and Video.

### Awarded By

A promotion may reference a CapoHub User (`awardedByUser`). If the
instructor does not use CapoHub, the promotion stores only text
(`awardedByName`, e.g. `Mestre João`), which remains plain text. CapoHub
never automatically links such text references with User accounts - the
author must explicitly connect the User. See
[ADR-010](../decisions/ADR-010-no-automatic-person-linking.md). Every
instructor reference therefore consists of `displayName` plus an optional
linked User; `displayName` always remains the source of truth, and if the
linked User account disappears, the displayed text remains unchanged.

## Business Rules

- A member's first Graduation Level within a Root Group's organization is
  granted through an **Initial Assignment**, not a promotion. Initial
  Assignment creates the member's first UserGraduationEntry and, with it,
  their UserCurrentGraduation record; it is not subject to
  graduation-order validation, since there is no prior entry to validate
  against, and it is distinct from both Administrative Override and
  Historical Import below. See
  [ADR-011](../decisions/ADR-011-graduation-order-validation.md#initial-assignment).
- History is immutable - every promotion creates a new historical entry;
  old entries are never modified in the sense of being overwritten by a
  later promotion (existing history is never overwritten by newer
  entries).
- A promotion (any grant after the Initial Assignment) must always:
  create a new UserGraduationEntry, update UserCurrentGraduation, and
  preserve previous entries. No previous graduation is deleted.
- Historical entries may be corrected (e.g. wrong promotion date, wrong
  graduation level, typo in a note, wrong instructor). Editing does not
  change the chronological nature of history; after editing,
  UserCurrentGraduation must be recalculated and chronology must remain
  valid.
- Deleting historical entries should be extremely rare; whenever possible,
  history should be corrected instead of removed. Deleting an entry
  automatically recalculates Current Graduation with no manual
  intervention required.
- Batch Promotion does not bypass graduation-order validation - each
  member is validated individually against the same rules as a normal
  promotion. If any member fails validation, the entire batch is rolled
  back and no UserGraduationEntry is created for any member. When
  validation passes for every member, the system creates one independent
  UserGraduationEntry per member (not one aggregate record), and each
  entry references the Batch it was created from. See
  [ADR-016](../decisions/ADR-016-batch-promotion.md) and
  [ADR-021](../decisions/ADR-021-transactional-operations.md).
- Graduation belongs to the member; the organization records it. Changing
  organization never removes historical achievements - the prior
  graduation becomes Legacy Graduation. See
  [ADR-015](../decisions/ADR-015-legacy-graduation.md).
- Every graduation is visible according to organizational permissions;
  organizations decide whether members can view only their own history,
  all graduations, instructors only, or administrators only. Visibility
  rules belong to the [Permissions](organization-domain.md#permissions)
  model.
- Graduation systems are never converted automatically when a member
  changes organization - see
  [ADR-014](../decisions/ADR-014-no-automatic-graduation-conversion.md).
- Historical Import entries are exempt from normal promotion order
  validation and may establish the oldest known historical record; future
  promotions must again follow the normal graduation order. See
  [ADR-011](../decisions/ADR-011-graduation-order-validation.md).
- CapoHub supports approximate historical precision when exact dates are
  unknown (e.g. "2012, unknown month" or "2012, estimated"); the domain
  simply allows incomplete historical precision, and exact UI treatment is
  out of scope for this document.

## Relationships

- UserGraduationEntry belongs to exactly one User and exactly one Root
  Group.
- UserGraduationEntry references the Group where the promotion occurred
  (which may be a descendant of the Root Group).
- UserGraduationEntry references exactly one GraduationLevel (and,
  through it, one GraduationCategory).
- UserGraduationEntry optionally references an `awardedByUser` (a User).
- UserGraduationEntry is the sole content of the User Graduation
  Aggregate's history, contained by `UserCurrentGraduation`.

## Lifecycle

Created by: an Initial Assignment (the member's first grant within a
Root Group's organization), a normal promotion, a Batch Promotion, a
Historical Import, or an Administrative Override. Once created, an entry
may be corrected (edited) but is only deleted in exceptional cases; both
corrections and deletions trigger recalculation of
`UserCurrentGraduation`.

## Validation Rules

- An Initial Assignment (a member's first entry within a Root Group's
  organization) is exempt from order validation by nature - there is no
  prior entry to validate against - and requires no elevated permissions
  or audit trail. It is not Administrative Override or Historical Import.
- Normal promotions (any subsequent entry) must satisfy graduation-order
  validation, duplicate prevention, future-date validation, and
  category-transition validity (see
  [ADR-011](../decisions/ADR-011-graduation-order-validation.md)).
- Batch Promotion validates each member individually against the same
  rules as a normal promotion before any entries are created; a single
  member's validation failure rolls back the entire batch (see
  [ADR-016](../decisions/ADR-016-batch-promotion.md)).
- Historical Import and Administrative Override entries are exempt from
  normal order validation but must be explicitly authorized, and are
  expected to be audited (administrator, timestamp, previous graduation,
  new graduation, reason).
- Editing or deleting an entry must trigger recalculation of the owning
  User's `UserCurrentGraduation` for that Root Group.

---

# UserCurrentGraduation

## Purpose

UserCurrentGraduation is a read model, optimized for querying a user's
current graduation. It exists purely for performance - without it, every
profile view would need to search the entire graduation history, which
becomes increasingly expensive over time. It never replaces Graduation
History, which remains the source of truth. See
[ADR-009](../decisions/ADR-009-graduation-history-source-of-truth.md) and
[ADR-027](../decisions/ADR-027-read-models-not-authoritative.md).

A User has **at most one** current graduation per Root Group (the
relationship is 0..1, not mandatory). The record does not exist until the
member's first Graduation Level is granted there via an
[Initial Assignment](../decisions/ADR-011-graduation-order-validation.md#initial-assignment) -
before that point, the User has no Current Graduation for that Root
Group's organization. The same user may simultaneously have a different
current graduation in another, independent Root Group's organization -
current graduations never conflict, because they belong to different
Root Groups.

## Responsibilities

UserCurrentGraduation stores:

- current Graduation Level
- current Graduation Category
- Root Group
- assigned date
- last updated

No historical information is stored here - it simply references the
newest valid `UserGraduationEntry`.

## Business Rules

- UserCurrentGraduation is never created or edited directly. It is
  determined by: the active GraduationSystem, the Graduation History, and
  the latest valid Graduation Entry.
- The record does not exist for a (User, Root Group) pair until that
  member's Initial Assignment is recorded; until then, the member has no
  Current Graduation in that organization.
- Deleting or editing the newest `UserGraduationEntry` automatically
  recalculates UserCurrentGraduation; no manual intervention is required.
- Users belonging to multiple organizations hold independent
  UserCurrentGraduation records per Root Group (each still 0..1); no
  synchronization occurs between them.

## Relationships

- UserCurrentGraduation belongs to exactly one User and exactly one Root
  Group (composite identity) when it exists; a (User, Root Group) pair
  has zero or one UserCurrentGraduation record.
- UserCurrentGraduation is the Aggregate Root of the User Graduation
  Aggregate, which contains that user's `UserGraduationEntry` history for
  the given Root Group.

## Lifecycle

Created automatically when the first `UserGraduationEntry` (an Initial
Assignment) is recorded for a (User, Root Group) pair. Recalculated
automatically whenever a subsequent `UserGraduationEntry` is created,
edited, or deleted for that pair. Never created or updated directly by
user action.

## Validation Rules

- Must not exist for a (User, Root Group) pair with zero
  `UserGraduationEntry` records.
- Must always reference the newest valid `UserGraduationEntry` for its
  (User, Root Group) pair after any history change.
