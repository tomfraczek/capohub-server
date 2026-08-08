import { Group } from '../../groups/entities/group.entity';
import { Community } from '../../groups/group-hierarchy.service';
import { EventCommunityRefDto } from '../dto/event-community-ref.dto';

export function toEventCommunityRefDto(
  community: Community,
): EventCommunityRefDto {
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
