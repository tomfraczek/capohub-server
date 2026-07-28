---
title: Glossary
description: Canonical definitions of terms used across CapoHub domain documentation.
status: Draft
version: 2.0.0
last_updated: 2026-07-28
---

# Glossary

> Every term is defined exactly once, here. Other documents should link to
> an entry instead of repeating its definition.
>
> **Terminology note (2026-07-28):** this glossary reflects the Group/Section
> domain rename (see ADR-031). The former terms `Organization` and `Root
> Group` are now simply `Group`; the former `Group` (a Child Group) is now
> `Section`; the former `Section` (a flat, non-hierarchical member tag) is
> now `Cohort`. Older documents in `docs/architecture/` may still use the
> pre-rename vocabulary - see the note at the top of each for the mapping.

| Term | Description |
|------|-------------|
| Academy | A physical training location belonging to one Group or Section. |
| Administrative Override | A dedicated, audited administrative operation used to correct mistakes in existing Graduation History or restore damaged records. Exempt from normal graduation-order validation; requires elevated permissions. Distinct from Historical Import and from Initial Assignment. |
| Batch Promotion | A single operation that promotes many members at once. Each member is validated individually against normal graduation-order rules; if any member fails validation, the entire operation is rolled back and no member is promoted. When validation passes, it creates an independent Graduation History entry for each member. |
| Cohort | An optional, flat subdivision inside a Group or Section, used to tag/group members for convenience (e.g. "Kids", "Monday practice"). Has no hierarchy of its own and no members/permissions independent of its owning Group/Section. Formerly called "Section" before the Group/Section rename (ADR-031) - not to be confused with the current meaning of Section. |
| Current Graduation | A User's most recent Graduation Level within a Group's organization, materialized as the `UserCurrentGraduation` read model. The relationship is 0..1: it does not exist until the User's Initial Assignment is recorded, and never replaces Graduation History as the source of truth. |
| Graduation History | The complete, immutable sequence of Graduation entries for a User within a Group's organization. It is the source of truth for graduation; Current Graduation is only a projection over it. |
| Graduation System | Complete definition of graduation rules used by one organization. Every Group has exactly one Graduation System - the relationship is mandatory (1:1). |
| Group | The top-level (root) organizational unit inside CapoHub - identified by having no parent. Same underlying entity as Section (there is no separate Organization/Group entity - see ADR-001, ADR-031), but presented and addressed (`/groups/:id`) distinctly at the API layer, since it is the container for a whole organization: a User's Membership is always identified by a Group, never a Section, and organization-wide concepts (Graduation System, organization-wide announcements/events) attach here. Formerly called "Organization" or "Root Group" before ADR-031. |
| Historical Import | A dedicated administrative operation used to bring in graduation history that predates an organization's adoption of CapoHub. Exempt from normal graduation-order validation, since earlier promotions may be unknown. Distinct from Administrative Override and from Initial Assignment. |
| Initial Assignment | The operation that grants a User's first Graduation Level within a Group's organization (e.g. after joining, or after a Legacy Graduation transfer). It is not a promotion, is not subject to graduation-order validation, and is distinct from both Administrative Override and Historical Import. It creates the `UserCurrentGraduation` record for that (User, Group) pair. |
| Legacy Graduation | A member's graduation from a previous organization. It remains visible and historical permanently but can never become the current graduation inside another organization. |
| Member (Role) | The base Role of every Group or Section, with no special case for either. Every other Role requires it, and the system guarantees this automatically: granting a Membership's first Role Assignment for a Group/Section also grants Member if it isn't Member itself; Member cannot be revoked while any other Role is still held there. Never created merely by creating a Membership - not even for the Group itself. Not to be confused with Membership. |
| Membership | Answers exactly one question: does this User belong to this Group's organization at all? Identified by the Group, but never a Section. Carries no authority and creates no Role Assignment by itself - not even Member for the Group, which is a Group/Section like any other. A Membership with zero Role Assignments anywhere is a normal, valid state (belongs to the organization, not yet assigned to any Group/Section). See Member (Role) and Role Assignment. |
| Owner (Role) | The one mandatory Role: every Group or Section must always have exactly one active Owner - never zero, never two. The database only guarantees *at most* one (a partial unique index); guaranteeing *at least* one is an application-layer responsibility, since a unique index cannot require a row to exist. Owner cannot be granted through the general grantRole/revokeRole flow and cannot be given up voluntarily - it moves only through an atomic ownership transfer (the previous Owner's Role Assignment is removed and the new Owner's is created in the same transaction). A Membership cannot be removed while it owns any Group or Section in the organization - ownership must be transferred explicitly first. See Role Assignment and Membership. |
| Permission | A fixed, system-wide capability a Role grants (e.g. edit trainings). Not organization- or user-configurable; extending the Permission enum requires a CapoHub code change and migration. |
| Public Code | A stable, immutable public identifier exposed by an object (Group, Section, Academy, User) for use in invitation links and QR codes. It is never a database identifier. |
| Role | A fixed, system-wide value (e.g. `Owner`, `Admin`, `Instructor`, `Member`) granted through a Role Assignment. Not organization- or user-configurable; there is no Custom Roles feature or Role editor, and extending the Role enum requires a CapoHub code change and migration. |
| Role Assignment | A grant of one system Role to a Membership for exactly one Group or Section, entirely independent of Membership's own fields. Requires the Membership to be active in that Group/Section's organization (i.e. its top-level Group), and expires logically the moment the Membership is no longer active. A Membership may hold several *different* Role Assignments for the same Group/Section at once (e.g. Member + Instructor + Admin together) - only holding the same Role twice for the same (Membership, Group/Section) pair is disallowed. See Member (Role) for the base-Role rule every other Role depends on. The same Membership may also hold Role Assignments for multiple different Groups/Sections at once. `Owner` is a mandatory exception: every Group or Section must have exactly one active Owner, moved only by an atomic ownership transfer. Management consists of exactly two operations, grantRole and revokeRole - there is no "change a Role" operation, since Roles for the same (Membership, Group/Section) are independent of one another. |
| Section | A Group nested under another Group or Section, at any depth (unlimited-depth hierarchy - ADR-002). Same underlying entity as Group, distinguished only by having a parent, but addressed separately at the API layer (`/sections/:id`) since it does not carry organization-wide membership - a Section is reached only through Role Assignments, never a direct Membership. Formerly called "Group" (a Child Group) before the Group/Section rename (ADR-031) - not to be confused with the former meaning of Section, now called Cohort. |
| Visibility Scope | The shared domain concept used by any module that publishes information to other users, to determine who may access that content. |
