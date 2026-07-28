import { Group } from '../../groups/entities/group.entity';
import { EventCommunityRefDto } from '../dto/event-community-ref.dto';

export function toEventCommunityRefDto(community: Group): EventCommunityRefDto {
  return {
    id: community.id,
    name: community.name,
    logoUrl: community.logoUrl,
    isRootGroup: community.parentGroup === null,
  };
}
