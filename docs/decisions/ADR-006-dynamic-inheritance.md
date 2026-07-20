# ADR-006: Dynamic Inheritance

## Status

Accepted

## Context

Some Group properties (logo, cover image, description, history) may inherit
from parent Groups, so a child Group does not have to duplicate branding
already defined higher in the hierarchy.

## Decision

Inheritance is dynamic. No values are copied between Groups.

Every inheritable property contains one of three modes:

- **OWN** - the Group provides its own value; inheritance stops.
- **INHERITED** - the value is taken from the nearest ancestor that provides
  `OWN`.
- **EMPTY** - the Group intentionally displays nothing; inheritance does not
  continue. Without `EMPTY` it would be impossible to intentionally remove
  inherited content (e.g. a local Group deciding not to display the World
  organization's long history).

## Consequences

Every property is resolved independently at read time; nothing is
duplicated into the child Group's own storage. See
[Inheritance](../architecture/organization-domain.md#inheritance) for the
full mode descriptions and the identity inheritance example.
