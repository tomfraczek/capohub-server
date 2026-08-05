import { SetMetadata } from '@nestjs/common';

// A row is either a Group or a Section - two physically distinct entity
// types since the Group/Section physical split (see group.entity.ts /
// section.entity.ts). `ROOT` here names "the Group table", not "a
// parentless Group" - a Group keeps this kind regardless of whether it has
// been attached under a parent via GroupHierarchyService (see
// group-permissions.guard.ts's kind check, which is purely
// `instanceof Group`).
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
