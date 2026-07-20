# ADR-008: Visibility Scope

## Status

Accepted

## Context

Many CapoHub modules publish information to other users (announcements,
events, polls, tasks, media, documents, notifications). Without a shared
visibility model, every module would implement its own recipient logic and
this would quickly become inconsistent.

## Decision

Visibility is implemented as a shared domain concept called **Visibility
Scope**. Announcements, Events, Polls, Tasks, Documents, and future modules
must all use the same visibility mechanism. No module may introduce its own
visibility model.

Visibility is always explicit; nothing is inherited automatically. The
creator always decides who should receive the content. Available levels:

- **Current Group** - visible only inside the Group where it was created.
- **Entire Subtree** - visible to the current Group and every descendant
  Group.
- **Selected Groups** - the author explicitly chooses which Groups.
- **Selected Sections** - visibility limited to specific Sections within a
  Group.
- **Individual Users (future)** - intentionally excluded from the
  Organization Domain for now.

Visibility is resolved dynamically at read/delivery time: Visibility Scope
→ resolve Groups → resolve Sections → resolve Members → deliver. No
duplicated recipient lists are stored. This guarantees that Membership
changes are immediately respected.

Group hierarchy targets (e.g. "Entire Subtree") are resolved by traversing
descendant Groups; this traversal never creates or implies Membership.
Sections never participate in hierarchy traversal - a Section always
belongs to exactly one Group, and selecting one Section never
automatically includes sibling Sections or the entire Group.

### Business Rules

- Visibility never changes Membership.
- Visibility never grants permissions.
- Visibility never creates relationships.
- Visibility only determines who may access a resource.

## Consequences

A single, consistent visibility mechanism is available to every module
that publishes content, avoiding per-module reinvention. See
[Visibility Scope](../architecture/organization-domain.md#visibility-scope)
for the full model and resolution diagrams.
