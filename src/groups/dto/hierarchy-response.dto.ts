// Minimal, mixed-kind reference to a Group or a Section, used for parent
// refs, direct-children lists and breadcrumbs. `type` is computed directly
// from the entity's own table (`instanceof Group`), never guessed from
// `parentGroup === null` - see the "no isRootGroup" note on
// CommunityHomeCommunityRefDto. This mirrors the one other place in this
// codebase that already represents a list mixing both kinds -
// CommunitySearchResultDto (discovery module) - rather than the two-
// separate-nullable-fields pattern used for a single Group-or-Section
// relation (RoleAssignment.group/section etc.): those two patterns solve
// different problems (one relation vs. a list of many), and this is a
// list.
export type HierarchyEntityKind = 'GROUP' | 'SECTION';

export interface HierarchyEntityRefDto {
  id: string;
  type: HierarchyEntityKind;
  name: string;
}
