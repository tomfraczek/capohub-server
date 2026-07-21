---
title: Organization Business Scenarios
description: Business scenarios supported by the Organization Domain, normalized to a common template, intended as the basis for integration tests.
status: Draft
version: 1.0.0
last_updated: 2026-07-20
---

# Organization Business Scenarios

> This chapter describes typical business scenarios supported by the
> Organization Domain. Their purpose is to demonstrate expected system
> behavior, and they should also serve as the basis for integration
> tests. For entity-level detail, see
> [organization-entities.md](organization-entities.md); for the
> underlying rules, see [organization-domain.md](organization-domain.md)
> and the [decisions](../decisions/) directory.

---

# Table of Contents

- [Scenario 1: Creating a New Organization](#scenario-1-creating-a-new-organization)
- [Scenario 2: Creating a Child Group](#scenario-2-creating-a-child-group)
- [Scenario 3: Creating a Local Group](#scenario-3-creating-a-local-group)
- [Scenario 4: Member Joins a Group](#scenario-4-member-joins-a-group)
- [Scenario 5: Assigning Sections](#scenario-5-assigning-sections)
- [Scenario 6: Group Without Sections](#scenario-6-group-without-sections)
- [Scenario 7: Organization Expansion](#scenario-7-organization-expansion)
- [Scenario 8: Promotion](#scenario-8-promotion)
- [Scenario 9: Batch Promotion](#scenario-9-batch-promotion)
- [Scenario 10: Historical Import](#scenario-10-historical-import)
- [Scenario 11: User Changes Organization](#scenario-11-user-changes-organization)
- [Scenario 12: Member Returns](#scenario-12-member-returns)
- [Scenario 13: Archiving a Group](#scenario-13-archiving-a-group)
- [Scenario 14: Group Hierarchy Is Fixed At Creation](#scenario-14-group-hierarchy-is-fixed-at-creation)
- [Scenario 15: Linking an Instructor](#scenario-15-linking-an-instructor)
- [Scenario 16: Removing a User](#scenario-16-removing-a-user)
- [Scenario 17: Parent Group Announcement](#scenario-17-parent-group-announcement)
- [Scenario 18: Local Announcement](#scenario-18-local-announcement)
- [Scenario 19: Instructor Promotion Validation](#scenario-19-instructor-promotion-validation)
- [Scenario 20: Administrative Override](#scenario-20-administrative-override)
- [Scenario 21: Assigning a Role](#scenario-21-assigning-a-role)
- [Scenario 22: Role Assignment Expires With Membership](#scenario-22-role-assignment-expires-with-membership)
- [Integration Test Recommendations](#integration-test-recommendations)

---

## Scenario 1: Creating a New Organization

### Goal

Create a completely new Capoeira organization.

### Initial State

No organization exists.

### Action

1. Create a Root Group.
2. Configure organization details.
3. Create the Graduation System.
4. Configure Graduation Categories.
5. Configure Graduation Levels.
6. Create Academies.
7. Create Sections (optional).
8. Invite administrators.
9. Invite members.

### Expected Result

The organization is ready for daily use.

---

## Scenario 2: Creating a Child Group

### Goal

Add a new organizational level under an existing Root Group.

### Initial State

```text
Capoeira Brasil
```

### Action

Administrator creates:

```text
Capoeira Brasil Poland
```

### Expected Result

The new Group:

- belongs to Capoeira Brasil,
- has no members,
- has no Sections,
- has no Academies,
- automatically uses the Root Graduation System,
- owns its own permissions.

---

## Scenario 3: Creating a Local Group

### Goal

Extend the hierarchy with a further nested Group.

### Initial State

```text
Capoeira Brasil
└── Poland
```

### Action

Create:

```text
Poznań
```

### Expected Result

Hierarchy becomes:

```text
Capoeira Brasil
└── Poland
    └── Poznań
```

No Memberships are created automatically.

---

## Scenario 4: Member Joins a Group

### Goal

Add a new member to a Group through the invitation flow.

### Initial State

User exists. The Group exists.

### Action

Administrator sends an invitation. The User accepts it.

### Expected Result

A Membership is created with status `ACTIVE`. The User belongs only to
that Group.

---

## Scenario 5: Assigning Sections

### Goal

Assign an existing member to one or more Sections.

### Initial State

User belongs to:

```text
Poznań
```

### Action

Administrator assigns the user to `Adults` and `Performance Team`.

### Expected Result

The User belongs to both Sections. No duplicate Membership is created.
One active Membership may be assigned to zero or more Sections, provided
every one of them belongs to the same Root Group as the Membership -
`Adults` and `Performance Team` must both belong to the organization
`Poznań` is part of.

---

## Scenario 6: Group Without Sections

### Goal

Confirm a Group can operate fully without ever defining Sections.

### Initial State

The Group contains Members, an Academy, and Trainings. No Sections exist.

### Action

(No action - Sections are never created.)

### Expected Result

Everything works normally. Sections are completely optional.

---

## Scenario 7: Organization Expansion

### Goal

Confirm hierarchy depth is unlimited in practice.

### Initial State

```text
Capoeira Brasil
```

### Action

Administrator creates `Poland`, then `Poznań`, then `North`.

### Expected Result

Unlimited hierarchy is supported. Nothing else changes.

---

## Scenario 8: Promotion

### Goal

Promote a member to a new graduation level.

### Initial State

Current graduation: `Yellow`.

### Action

Instructor promotes the member to `Yellow / Blue`.

### Expected Result

A new Graduation Entry is created. Current Graduation becomes
`Yellow / Blue`. The previous graduation remains in history.

---

## Scenario 9: Batch Promotion

### Goal

Promote many members at once during a mass event.

### Initial State

120 members participate in Batizado.

### Action

Instructor selects `Blue`, then selects all 120 members.

### Expected Result

Each of the 120 members is validated individually against normal
graduation-order rules for `Blue`, the same as a single promotion. If
every member passes validation, 120 Graduation History entries are
created and 120 Current Graduations are updated. If even one member
fails validation, the entire operation is rolled back and no member is
promoted - the operation executes transactionally (all or nothing).

---

## Scenario 10: Historical Import

### Goal

Import pre-existing graduation history from another system.

### Initial State

Administrator migrates data from another system. Known information: `Blue
- 2015`. Earlier history is unavailable.

### Action

Administrator performs a Historical Import for `Blue - 2015`.

### Expected Result

Historical import creates the `Blue - 2015` entry. No previous
graduations are required.

---

## Scenario 11: User Changes Organization

### Goal

Handle a member moving from one independent organization to another.

### Initial State

Current organization: `Capoeira Brasil`. Current graduation: `Blue`.

### Action

User joins `Muzenza`.

### Expected Result

`Blue` becomes Legacy. The new organization has no Current Graduation
yet, since no `UserCurrentGraduation` record exists until a Graduation
Level is first granted there. An instructor later performs an **Initial
Assignment** - not a promotion, and not subject to graduation-order
validation - to grant the member's first Graduation Level in the new
organization, which creates the `UserCurrentGraduation` record.

---

## Scenario 12: Member Returns

### Goal

Allow a former member to rejoin a Group without losing history.

### Initial State

History: joined in 2018, Membership archived in 2021. The member had been
assigned to the `Adults` Section before the Membership was archived; that
Section assignment was not removed when the Membership ended.

### Action

Member returns.

### Expected Result

A new `ACTIVE` Membership is created. The historical Membership remains
archived, together with its `Adults` Section assignment - it is not
carried over to the new Membership, since a Section assignment belongs to
one specific Membership record. Nothing is overwritten. If the member
should be in `Adults` again, an administrator assigns the new Membership
to it explicitly.

---

## Scenario 13: Archiving a Group

### Goal

Retire a Group while preserving its historical data.

### Initial State

`Poznań` is an active Group.

### Action

Administrator archives `Poznań`.

### Expected Result

New operations become unavailable. Historical references remain valid.
No data is deleted.

---

## Scenario 14: Group Hierarchy Is Fixed At Creation

### Goal

Confirm that a Group's position in the hierarchy can never change once
created - there is no operation to re-parent an existing Group.

### Initial State

```text
Capoeira Brasil
└── Poland
    └── Poznań
```

### Action

Administrator attempts to move `Poznań` under `Germany`, or to detach
`Poznań` so it becomes its own Root Group.

### Expected Result

The operation is rejected - no such operation exists. `Poznań` remains
exactly where it was created:

```text
Capoeira Brasil
└── Poland
    └── Poznań
```

`parentGroupId` is set once, at creation, through `GroupHierarchyService`,
and is immutable afterward. If an organization needs a different
structure, it must create new Groups with the desired parents; existing
Groups are never reparented. See
[Hierarchy](organization-domain.md#hierarchy-rules).

---

## Scenario 15: Linking an Instructor

### Goal

Connect a text-based instructor reference to a real User account.

### Initial State

Graduation history contains `Awarded by: Mestre João`.

### Action

Mestre João creates a CapoHub account.

### Expected Result

Nothing changes automatically. An administrator explicitly links the
User. The displayed text remains identical; the name simply becomes
clickable.

---

## Scenario 16: Removing a User

### Goal

Confirm historical accuracy survives deletion of a linked User account.

### Initial State

A linked User deletes their account. Graduation History contains `Awarded
by: Mestre João`.

### Action

(User account deletion, triggered externally.)

### Expected Result

The displayed text remains. The optional User reference is removed.
Historical information remains readable.

---

## Scenario 17: Parent Group Announcement

### Goal

Publish an announcement visible to an entire subtree.

### Initial State

```text
Capoeira Brasil
└── Poland
    ├── Poznań
    └── Kraków
```

### Action

Poland publishes an announcement with visibility `Entire Subtree`.

### Expected Result

Recipients include Poland, Poznań, and Kraków. Membership inheritance is
not used; recipients are resolved dynamically.

---

## Scenario 18: Local Announcement

### Goal

Publish an announcement visible only to the current Group.

### Initial State

Hierarchy identical to Scenario 17.

### Action

Poland publishes an announcement with visibility `Current Group`.

### Expected Result

Only Poland receives the announcement. Descendant Groups do not.

---

## Scenario 19: Instructor Promotion Validation

### Goal

Confirm the system rejects a promotion that violates graduation order.

### Initial State

Current graduation: `Yellow`.

### Action

Instructor attempts to promote directly to `Blue / Green`.

### Expected Result

The operation is rejected. The promotion order violates the
organization's Graduation System.

---

## Scenario 20: Administrative Override

### Goal

Correct an incorrect historical promotion using Administrative Override.

### Initial State

Administrator discovers an incorrect historical promotion. Current
history: `Blue → Green`. Correct history should be:
`Blue → Blue / Green → Green`.

### Action

Administrator performs an Administrative Override.

### Expected Result

The operation is audited. Current Graduation is recalculated
automatically.

---

## Scenario 21: Assigning a Role

### Goal

Grant a member authority over a specific Group, independently of
Membership, using only the fixed system Role enum.

### Initial State

```text
Capoeira Brasil (Root Group A)
├── Poznań
└── Leszno
```

Jan's Membership belongs to Root Group `Capoeira Brasil` and is `ACTIVE`.

### Action

1. Administrator grants Jan's Membership a `Member` RoleAssignment for
   `Capoeira Brasil` itself.
2. Administrator grants Jan's Membership an `Instructor` RoleAssignment
   for Child Group `Poznań` - since this is Jan's first RoleAssignment for
   `Poznań`, a `Member` RoleAssignment for `Poznań` is granted
   automatically alongside it.
3. Administrator grants Jan's Membership an additional `Admin`
   RoleAssignment for the *same* Child Group `Poznań`, on top of the
   `Member` and `Instructor` he already holds there.
4. Administrator grants Jan's Membership an `Instructor` RoleAssignment
   for Child Group `Leszno` (with `Member` again granted automatically).
5. Administrator then attempts to grant Jan's Membership a *second*
   `Instructor` RoleAssignment for `Poznań`, where it already holds one.

### Expected Result

Jan ends up holding, at the same time: `Member` in `Capoeira Brasil`;
`Member`, `Instructor`, and `Admin` **all three at once** in `Poznań`; and
`Member` and `Instructor` in `Leszno`. Jan's Membership is untouched
throughout; it never stores a Role. Granting `Admin` in step 3 did not
remove or replace `Member` or `Instructor` in `Poznań` - RoleAssignments
for the same (Membership, Group) pair coexist as long as their Role
differs. Holding these Roles in `Poznań` grants no authority in `Leszno`
or in `Capoeira Brasil`, and vice versa - Roles never inherit through the
hierarchy, including between sibling Child Groups. Step 5 is rejected:
holding the exact same Role twice for the same (Membership, Group) pair
is the only thing disallowed (`UNIQUE (membership, group, role)`). A later
attempt to grant a RoleAssignment for `Poznań` to a *different* user who
has no active Membership in `Capoeira Brasil` is rejected. An attempt to
grant a Role outside the fixed system Role enum (a made-up,
organization-defined Role name) is also rejected - Roles are never
configurable.

---

## Scenario 22: Role Assignment Expires With Membership

### Goal

Confirm that ending a Membership immediately removes the authority every
dependent RoleAssignment granted, without a separate revocation step.

### Initial State

A user holds an active Membership in `Capoeira Brasil`, plus an
`Instructor` RoleAssignment for `Capoeira Brasil` and a second `Admin`
RoleAssignment for the Child Group `Poznań`.

### Action

The user leaves `Capoeira Brasil` (or is removed by an administrator);
the Membership becomes `ARCHIVED`.

### Expected Result

Both RoleAssignments stop granting any authority at that same moment -
logically, not through a separate revocation action. Neither
RoleAssignment record is deleted; each remains as a historical record of
which Roles the user previously held, the same way a Section assignment
remains in place after Membership ends (see
[Section](organization-entities.md#section)). If the user later rejoins
`Capoeira Brasil` with a brand new Membership, an administrator must
grant fresh RoleAssignments explicitly - none are carried over from the
archived Membership.

---

# Integration Test Recommendations

Every scenario described above should be implemented as an integration
test. Whenever a business rule changes, the corresponding scenario should
be updated first; the implementation should then be modified until all
scenarios pass. This document represents the expected behavior of the
Organization Domain - if implementation and documentation differ, the
documentation should be treated as the authoritative business
specification until intentionally revised.

## Recommended Test Categories

- **Unit Tests** - business rules inside Domain Services.
- **Integration Tests** - Aggregate interactions.
- **Migration Tests** - organization migration, graduation migration,
  historical imports.
- **Regression Tests** - previously reported edge cases.
- **Authorization Tests** - permission evaluation, visibility resolution,
  administrative overrides.
