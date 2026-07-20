---
title: CapoHub Vision
description: Product philosophy and guiding principles behind CapoHub.
status: Draft
version: 1.0.0
last_updated: 2026-07-20
---

# Vision

> This document captures the philosophy behind CapoHub as expressed in the
> Organization Domain specification. It is the canonical location for
> project-wide guiding principles; domain documents should link here instead
> of restating them.

---

# Table of Contents

- [Business First](#business-first)
- [No Hidden Logic](#no-hidden-logic)
- [Graduation Philosophy: Never Hardcode Capoeira Rules](#graduation-philosophy-never-hardcode-capoeira-rules)

---

# Business First

The domain model reflects how Capoeira organizations work in reality.

Database implementation is a consequence of business rules, never the opposite.

---

# No Hidden Logic

Business rules should always be explicit.

The application should never guess relationships between entities.

Examples:

- people are never linked automatically
- organizations are never merged automatically
- graduation systems are never converted automatically

Every important operation requires an explicit user decision.

---

# Graduation Philosophy: Never Hardcode Capoeira Rules

Every Capoeira organization has its own graduation system.

Even organizations with similar cord colors often differ in:

- graduation order,
- category names,
- instructor titles,
- color combinations,
- promotion rules.

For this reason CapoHub never hardcodes any graduation logic.

Instead every Root Group owns its own Graduation System.

---

> Organization-specific design principles (Everything Is A Group, Unlimited
> Hierarchy, Sections Are Optional) live in
> [organization-domain.md](../architecture/organization-domain.md#design-principles),
> since they describe how one specific domain applies the philosophy above,
> not the philosophy itself.

<!--
TODO (documentation reorganization, 2026-07-20): the request that produced
this split anticipated the following named vision pillars, which do not
appear verbatim anywhere in the source document:
  - "Explicit over Implicit"
  - "No Hardcoded Capoeira Rules" (only the graduation-specific instance
    above exists; no project-wide statement under this name)
  - "History over Convenience"
  - "Organization Independence"
  - "Unlimited Scalability"
Related ideas exist in the source (e.g. "Unlimited Hierarchy" in
organization-domain.md is close to "Unlimited Scalability"; "Independent
Identity" under Hierarchy Rules is close to "Organization Independence";
the many "history is never deleted" rules are close to "History over
Convenience"), but none is phrased or scoped as a standalone vision
statement. Nothing has been invented to fill this gap - if these five
pillars should become official CapoHub vision statements, they need to be
authored explicitly.
-->
