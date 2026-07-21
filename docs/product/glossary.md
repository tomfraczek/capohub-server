---
title: Glossary
description: Canonical definitions of terms used across CapoHub domain documentation.
status: Draft
version: 1.0.0
last_updated: 2026-07-20
---

# Glossary

> Every term is defined exactly once, here. Other documents should link to
> an entry instead of repeating its definition.

| Term | Description |
|------|-------------|
| Academy | A physical training location belonging to one Group. |
| Administrative Override | A dedicated, audited administrative operation used to correct mistakes in existing Graduation History or restore damaged records. Exempt from normal graduation-order validation; requires elevated permissions. Distinct from Historical Import and from Initial Assignment. |
| Batch Promotion | A single operation that promotes many members at once. Each member is validated individually against normal graduation-order rules; if any member fails validation, the entire operation is rolled back and no member is promoted. When validation passes, it creates an independent Graduation History entry for each member. |
| Child Group | Any Group that has a parent. |
| Current Graduation | A User's most recent Graduation Level within a Root Group's organization, materialized as the `UserCurrentGraduation` read model. The relationship is 0..1: it does not exist until the User's Initial Assignment is recorded, and never replaces Graduation History as the source of truth. |
| Graduation History | The complete, immutable sequence of Graduation entries for a User within a Root Group's organization. It is the source of truth for graduation; Current Graduation is only a projection over it. |
| Graduation System | Complete definition of graduation rules used by one organization. Every Root Group has exactly one Graduation System - the relationship is mandatory (1:1). |
| Group | Any organizational unit inside CapoHub. |
| Historical Import | A dedicated administrative operation used to bring in graduation history that predates an organization's adoption of CapoHub. Exempt from normal graduation-order validation, since earlier promotions may be unknown. Distinct from Administrative Override and from Initial Assignment. |
| Initial Assignment | The operation that grants a User's first Graduation Level within a Root Group's organization (e.g. after joining, or after a Legacy Graduation transfer). It is not a promotion, is not subject to graduation-order validation, and is distinct from both Administrative Override and Historical Import. It creates the `UserCurrentGraduation` record for that (User, Root Group) pair. |
| Legacy Graduation | A member's graduation from a previous organization. It remains visible and historical permanently but can never become the current graduation inside another organization. |
| Member (Role) | The base Role of every Group - Root or Child, with no special case for either. Every other Role requires it, and the system guarantees this automatically: granting a Membership's first Role Assignment for a Group also grants Member if it isn't Member itself; Member cannot be revoked while any other Role is still held for that Group. Never created merely by creating a Membership - not even for the Root Group. Not to be confused with Membership. |
| Membership | Answers exactly one question: does this User belong to this Organization at all? Identified by the Organization's Root Group, but never a Child Group. Carries no authority and creates no Role Assignment by itself - not even Member for the Root Group, which is a Group like any other. A Membership with zero Role Assignments anywhere is a normal, valid state (belongs to the Organization, not yet assigned to any Group). See Member (Role) and Role Assignment. |
| Organization | The container for a Group hierarchy, identified by its Root Group - not a separate entity of its own. Used for organization-wide things only (Graduation System, organization-wide announcements/events). A User's Membership means "belongs to this Organization"; it says nothing about which specific Group(s), including the Root Group itself, the User actually participates in day to day - that is answered by Member (Role) and Role Assignment for each Group individually. |
| Owner (Role) | The one mandatory Role: every Group must always have exactly one active Owner, Root or Child alike - never zero, never two. The database only guarantees *at most* one (a partial unique index); guaranteeing *at least* one is an application-layer responsibility, since a unique index cannot require a row to exist. Owner cannot be granted through the general grantRole/revokeRole flow and cannot be given up voluntarily - it moves only through an atomic ownership transfer (the previous Owner's Role Assignment is removed and the new Owner's is created in the same transaction). A Membership cannot be removed while it owns any Group in the Organization - ownership must be transferred explicitly first. See Role Assignment and Membership. |
| Permission | A fixed, system-wide capability a Role grants (e.g. edit trainings). Not organization- or user-configurable; extending the Permission enum requires a CapoHub code change and migration. |
| Public Code | A stable, immutable public identifier exposed by an object (Group, Academy, User) for use in invitation links and QR codes. It is never a database identifier. |
| Role | A fixed, system-wide value (e.g. `Owner`, `Admin`, `Instructor`, `Member`) granted through a Role Assignment. Not organization- or user-configurable; there is no Custom Roles feature or Role editor, and extending the Role enum requires a CapoHub code change and migration. |
| Role Assignment | A grant of one system Role to a Membership for exactly one Group (Root or Child), entirely independent of Membership's own fields. Requires the Membership to be active in that Group's Root Group, and expires logically the moment the Membership is no longer active. A Membership may hold several *different* Role Assignments for the same Group at once (e.g. Member + Instructor + Admin together) - only holding the same Role twice for the same (Membership, Group) pair is disallowed. See Member (Role) for the base-Role rule every other Role depends on. The same Membership may also hold Role Assignments for multiple different Groups at once. `Owner` is a mandatory exception: every Group must have exactly one active Owner, moved only by an atomic ownership transfer. Management consists of exactly two operations, grantRole and revokeRole - there is no "change a Role" operation, since Roles for the same (Membership, Group) are independent of one another. |
| Root Group | A Group without a parent; the highest level in its hierarchy, and the identifier of its Organization. In every other respect it is a Group like any other - it has its own daily life and its own Members, and is never automatically populated with Role Assignments just because a User holds a Membership identified by it. |
| Section | An optional subdivision inside a Group. |
| Visibility Scope | The shared domain concept used by any module that publishes information to other users, to determine who may access that content. |
