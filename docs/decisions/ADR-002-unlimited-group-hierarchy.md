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

- A dedicated domain service (`GroupHierarchyService` - see
  [organization-entities.md](../architecture/organization-entities.md))
  validates a Group's parent at creation time (existence, archived status)
  and resolves Root Group/ancestors/descendants; every Group has at most
  one parent.
- No feature may hardcode a fixed number of hierarchy levels.
- `parentGroupId` is set once, at creation, and is immutable afterward -
  there is no attach, detach, or move operation. A Group's Root Group is
  therefore fixed for its entire lifetime, as a direct consequence of
  this immutability. Organization changes for a member happen exclusively
  through Membership (ending the old one, creating a new one in the new
  Root Group), never by re-parenting a Group.
