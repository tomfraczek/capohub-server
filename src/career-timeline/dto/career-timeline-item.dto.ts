import { EventType } from '../../events/enums/event-type.enum';
import { EventCommunityRefDto } from '../../events/dto/event-community-ref.dto';
import { CordSegmentResponseDto } from '../../graduation/dto/rank-response.dto';
import { RankTrack } from '../../graduation/enums/rank-track.enum';
import { CareerTimelineCategory } from '../enums/career-timeline-category.enum';

interface BaseCareerTimelineItemDto {
  // Stable across reads - either a deterministic composite of source type +
  // source id (e.g. "formal-rank:<assignmentId>") for automatic entries, or
  // the CareerTimelineEntry's own UUID for CUSTOM. Never a value randomly
  // generated per request (see the module spec).
  id: string;
  occurredOn: string;
  title: string;
  description: string | null;
}

export interface CapoeiraStartTimelineItemDto extends BaseCareerTimelineItemDto {
  category: CareerTimelineCategory.CAPOEIRA_START;
}

export interface FormalGroupRefDto {
  groupId: string;
  name: string;
}

export interface FormalGroupJoinedTimelineItemDto extends BaseCareerTimelineItemDto {
  category: CareerTimelineCategory.FORMAL_GROUP_JOINED;
  group: FormalGroupRefDto;
}

export interface FormalGroupLeftTimelineItemDto extends BaseCareerTimelineItemDto {
  category: CareerTimelineCategory.FORMAL_GROUP_LEFT;
  group: FormalGroupRefDto;
}

// Minimal evidence reference to a linked Event (see the module spec, rule
// 6) - deliberately smaller than CareerTimelineEventRefDto below, since
// this is a secondary reference on a FORMAL_RANK item, not the item itself.
export interface FormalRankLinkedEventRefDto {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface CareerTimelineFormalRankDto {
  assignmentId: string;
  rankId: string;
  name: string;
  track: RankTrack;
  cordSegments: CordSegmentResponseDto[];
  sourceGroup: { id: string; name: string };
  awardedByName: string | null;
  startedOn: string;
}

export interface FormalRankTimelineItemDto extends BaseCareerTimelineItemDto {
  category: CareerTimelineCategory.FORMAL_RANK;
  rank: CareerTimelineFormalRankDto;
  event: FormalRankLinkedEventRefDto | null;
}

export interface CareerTimelineEventRefDto {
  eventId: string;
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  // Null for a User-organized Event (see EventResponseDto.community and
  // events/event-community.util.ts) - it belongs to no Group/Section.
  community: EventCommunityRefDto | null;
  locationName: string | null;
  locationAddress: string | null;
}

export interface EventTimelineItemDto extends BaseCareerTimelineItemDto {
  category: CareerTimelineCategory.EVENT;
  event: CareerTimelineEventRefDto;
}

export interface CustomTimelineItemDto extends BaseCareerTimelineItemDto {
  category: CareerTimelineCategory.CUSTOM;
}

export type CareerTimelineItemDto =
  | CapoeiraStartTimelineItemDto
  | FormalGroupJoinedTimelineItemDto
  | FormalGroupLeftTimelineItemDto
  | FormalRankTimelineItemDto
  | EventTimelineItemDto
  | CustomTimelineItemDto;
