import { SetMetadata } from '@nestjs/common';

// A Group row is presented as "Group" (root, parentGroup === null) or
// "Section" (non-root, any depth) at the API layer, even though both are
// the same underlying entity (see the Group/Section rename ADR - there is
// deliberately no physical split, mirroring ADR-001's "no separate
// Group entity" philosophy one level down).
export enum GroupKind {
  ROOT = 'ROOT',
  SECTION = 'SECTION',
}

export const GROUP_KIND_KEY = 'groupKind';

// Restricts a @RequireGroupPermission(...) handler to acting only on a
// Group whose kind matches - e.g. GroupsController's single-resource routes
// require ROOT so a Section id 404s there instead of being silently served,
// and SectionsController's single-resource routes require SECTION so a
// Group id 404s there. Only takes effect where GroupPermissionsGuard is
// applied. Deliberately NOT applied to routes that accept either kind as a
// parent (e.g. "create/list a Section under :groupId-or-:sectionId") -
// see GroupPermissionsGuard for the check and its 404-not-403 rationale.
export const RequireGroupKind = (
  kind: GroupKind,
): ReturnType<typeof SetMetadata> => SetMetadata(GROUP_KIND_KEY, kind);
