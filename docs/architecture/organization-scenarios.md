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
- [Scenario 14: Moving a Group](#scenario-14-moving-a-group)
- [Scenario 15: Linking an Instructor](#scenario-15-linking-an-instructor)
- [Scenario 16: Removing a User](#scenario-16-removing-a-user)
- [Scenario 17: Parent Group Announcement](#scenario-17-parent-group-announcement)
- [Scenario 18: Local Announcement](#scenario-18-local-announcement)
- [Scenario 19: Instructor Promotion Validation](#scenario-19-instructor-promotion-validation)
- [Scenario 20: Administrative Override](#scenario-20-administrative-override)
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

History: joined in 2018, Membership archived in 2021.

### Action

Member returns.

### Expected Result

A new `ACTIVE` Membership is created. The historical Membership remains
archived. Nothing is overwritten.

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

## Scenario 14: Moving a Group

### Goal

Re-parent an existing subtree to a different Group.

### Initial State

```text
Capoeira Brasil
└── Poland
    └── Poznań
```

### Action

Administrator moves `Poznań` under `Germany`.

### Expected Result

Hierarchy becomes:

```text
Capoeira Brasil
├── Poland
└── Germany
    └── Poznań
```

Memberships remain unchanged. Permissions remain unchanged. The
Graduation System continues to follow the Root Group. If the Root Group
changes, organization-specific migration rules apply.

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
