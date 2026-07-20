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
| Membership | Relationship between a User and a Root Group - never a Child Group. |
| Public Code | A stable, immutable public identifier exposed by an object (Group, Academy, User) for use in invitation links and QR codes. It is never a database identifier. |
| Root Group | A group without a parent. Represents the highest organizational level. |
| Section | An optional subdivision inside a Group. |
| Visibility Scope | The shared domain concept used by any module that publishes information to other users, to determine who may access that content. |
