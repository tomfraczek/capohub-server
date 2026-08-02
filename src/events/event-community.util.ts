import { Section } from '../groups/entities/section.entity';
import { Community } from '../groups/group-hierarchy.service';
import { Event } from './entities/event.entity';

// Event.community is represented by two nullable FKs (communityGroup/
// communitySection), exactly one of which is ever set - see
// event.entity.ts.
export function eventCommunity(event: Event): Community {
  return (event.communityGroup ?? event.communitySection)!;
}

export function assignEventCommunity(event: Event, community: Community): void {
  if (community instanceof Section) {
    event.communitySection = community;
    event.communityGroup = null;
  } else {
    event.communityGroup = community;
    event.communitySection = null;
  }
}
