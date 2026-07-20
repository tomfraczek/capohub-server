# ADR-002: Unlimited Group Hierarchy

## Status

Accepted

## Context

Real Capoeira organizations form structures ranging from a single independent
school to a multi-level international federation (world, continent, country,
region, city, local school). The system must not assume a fixed number of
levels.

## Decision

Hierarchy is represented only by the `parentGroup` relationship. No
additional hierarchy entities exist.

Hierarchy depth is unlimited. The application never assumes a fixed hierarchy
level. The following structure is completely valid:

```text
World
└── Europe
    └── Poland
        └── Greater Poland
            └── Poznań
                └── North
                    └── Monday Group
```

Every level is represented by the same entity.

## Consequences

- Hierarchy modifications must go through a dedicated domain service
  (`GroupHierarchyService` - see
  [organization-entities.md](../architecture/organization-entities.md)) that
  validates the tree stays acyclic and that every Group has at most one
  parent.
- No feature may hardcode a fixed number of hierarchy levels.
