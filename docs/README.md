# CapoHub Documentation

This directory contains CapoHub's architectural and product documentation
for the Organization Domain, reorganized following Domain Driven Design
practices so it stays maintainable over many years of project growth.

---

## Directory Structure

```text
docs/
├── README.md                          # this file
├── api-conventions.md                 # API conventions (unrelated to the Organization Domain)
├── architecture/
│   ├── organization-domain.md         # main architecture document
│   ├── organization-entities.md       # detailed per-entity reference
│   └── organization-scenarios.md      # business scenarios + integration test recommendations
├── decisions/
│   └── ADR-001 .. ADR-028             # one Architecture Decision Record per file
├── diagrams/
│   └── *.mmd                          # Mermaid diagrams referenced from the docs above
└── product/
    ├── vision.md                      # cross-domain philosophy / design principles
    └── glossary.md                    # single source of truth for terminology
```

---

## Documents

| Document | Purpose |
|---|---|
| [architecture/organization-domain.md](architecture/organization-domain.md) | The main architecture document: purpose, design principles, philosophy, organization model, Group/Academy/Section/Membership/Roles/Permissions/Invitations overview, Visibility Scope, Hierarchy, Inheritance, cross-domain principles, aggregate overview, and dependency rules. Start here. |
| [architecture/organization-entities.md](architecture/organization-entities.md) | Deep-dive reference for every entity (Group, Academy, Section, Membership, RoleAssignment, Invitation, GraduationSystem, GraduationCategory, GraduationLevel, UserGraduationEntry, UserCurrentGraduation): purpose, responsibilities, business rules, relationships, lifecycle, and validation rules. |
| [architecture/organization-scenarios.md](architecture/organization-scenarios.md) | Every business scenario supported by the Organization Domain, normalized to Goal / Initial State / Action / Expected Result, plus integration test recommendations. |
| [decisions/](decisions/) | One Architecture Decision Record (ADR-001 through ADR-028) per significant decision, each with Status / Context / Decision / Consequences. |
| [diagrams/](diagrams/) | Mermaid source files (`.mmd`) for every diagram referenced by the documents above. |
| [product/vision.md](product/vision.md) | CapoHub-wide product philosophy and design principles that apply beyond the Organization Domain (Business First, No Hidden Logic). |
| [product/glossary.md](product/glossary.md) | Single source of truth for terminology - every term is defined exactly once. |
| [api-conventions.md](api-conventions.md) | API-level conventions, unrelated to the Organization Domain reorganization. |

---

## Recommended Reading Order

1. [product/vision.md](product/vision.md) - the philosophy everything else builds on.
2. [architecture/organization-domain.md](architecture/organization-domain.md) - the main architecture document.
3. [architecture/organization-entities.md](architecture/organization-entities.md) - entity-level detail, as needed.
4. [architecture/organization-scenarios.md](architecture/organization-scenarios.md) - concrete behavior and test scenarios.
5. [decisions/](decisions/) - consult individual ADRs when you need the reasoning behind a specific rule.
6. [product/glossary.md](product/glossary.md) - reference, as needed, for any unfamiliar term.

---

## Provenance Note

This structure was produced by splitting a single monolithic document
(`architecture/organization-domain.md.` in a prior revision) into the
files above. No business rules, architectural decisions, or content were
removed or invented during the split - only reorganized, deduplicated,
and cross-referenced. Places where the source document was internally
inconsistent (and required a judgment call to reconcile rather than an
invented decision) are marked with `TODO` comments in the relevant files;
search for `TODO` across `architecture/` and `decisions/` to find them
all.
