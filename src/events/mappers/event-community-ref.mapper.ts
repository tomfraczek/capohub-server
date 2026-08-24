import { Group } from '../../groups/entities/group.entity';
import { Community } from '../../groups/group-hierarchy.service';
import { EventCommunityRefDto } from '../dto/event-community-ref.dto';

// Returns null for a User-organized Event (see event-community.util.ts's
// eventCommunity, which this always receives its input from) - `community`
// stays a backward-compatible field on EventResponseDto for Group/Section
// navigation, but has nothing to report when the organizer is a User
// directly (see EventOrganizerRefDto for the field that always resolves).
export function toEventCommunityRefDto(
  community: Community | null,
): EventCommunityRefDto | null {
  if (!community) {
    return null;
  }
  return {
    id: community.id,
    name: community.name,
    logoUrl: community.logoUrl,
    // Type-based, not a `parentGroup === null` check - see the
    // organizational-domain rebuild, stage 1: a Section is never "root"
    // regardless of whether it currently has a parent.
    isRootGroup: community instanceof Group && community.parentGroup === null,
    communityType: community instanceof Group ? 'GROUP' : 'SECTION',
  };
}
