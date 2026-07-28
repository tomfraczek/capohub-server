import { GroupStatus } from '../../groups/enums/group-status.enum';

export type CommunitySearchResultType = 'GROUP' | 'SECTION';

// One row shape for both tabs ("Groups" and "Sections") and the unified
// "All" tab (client splits by `type`) - see the Group/Section rename ADR's
// "Discover Community" section. `parentId` is only meaningful for a
// SECTION result (its immediate parent, which may itself be a Group or
// another Section); `sectionsCount` is only meaningful for a GROUP result
// (count of its direct Sections, not the whole subtree) - each is `null`
// on the row shape it doesn't apply to, rather than two separate DTOs,
// since a client rendering the "All" tab needs one consistent row shape.
export interface CommunitySearchResultDto {
  id: string;
  type: CommunitySearchResultType;
  name: string;
  // Only present when the Group/Section has one - see the "no slug field"
  // note in the rename ADR.
  publicCode: string | null;
  logoUrl: string | null;
  country: string | null;
  city: string | null;
  description: string | null;
  isPublic: boolean;
  isHidden: boolean;
  status: GroupStatus;
  parentId: string | null;
  sectionsCount: number | null;
}
