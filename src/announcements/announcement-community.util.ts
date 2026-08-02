import { Section } from '../groups/entities/section.entity';
import { Community } from '../groups/group-hierarchy.service';
import { Announcement } from './entities/announcement.entity';

// Announcement.community is represented by two nullable FKs
// (communityGroup/communitySection), exactly one of which is ever set -
// see announcement.entity.ts.
export function announcementCommunity(announcement: Announcement): Community {
  return (announcement.communityGroup ?? announcement.communitySection)!;
}

export function assignAnnouncementCommunity(
  announcement: Announcement,
  community: Community,
): void {
  if (community instanceof Section) {
    announcement.communitySection = community;
    announcement.communityGroup = null;
  } else {
    announcement.communityGroup = community;
    announcement.communitySection = null;
  }
}
