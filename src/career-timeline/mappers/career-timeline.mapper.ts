import { eventCommunity } from '../../events/event-community.util';
import { Event } from '../../events/entities/event.entity';
import { toEventCommunityRefDto } from '../../events/mappers/event-community-ref.mapper';
import { FormalGroupAffiliation } from '../../groups/entities/formal-group-affiliation.entity';
import { FormalRankAssignment } from '../../graduation/entities/formal-rank-assignment.entity';
import { User } from '../../users/entities/user.entity';
import { CareerTimelineEntry } from '../entities/career-timeline-entry.entity';
import { CareerTimelineCategory } from '../enums/career-timeline-category.enum';
import {
  CapoeiraStartTimelineItemDto,
  CustomTimelineItemDto,
  EventTimelineItemDto,
  FormalGroupJoinedTimelineItemDto,
  FormalGroupLeftTimelineItemDto,
  FormalRankTimelineItemDto,
} from '../dto/career-timeline-item.dto';

// MikroORM's postgres driver returns a `date` column as a plain
// "YYYY-MM-DD" string at runtime despite the entity's TS type - same
// normalization as UserProfileMapper.toDateOnly /
// FormalRankAssignmentMapper.toDateOnly.
export function toDateOnly(date: Date | string): string {
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}

export function capoeiraStartId(userId: string): string {
  return `capoeira-start:${userId}`;
}

export function formalGroupJoinedId(affiliationId: string): string {
  return `formal-group-joined:${affiliationId}`;
}

export function formalGroupLeftId(affiliationId: string): string {
  return `formal-group-left:${affiliationId}`;
}

export function formalRankId(assignmentId: string): string {
  return `formal-rank:${assignmentId}`;
}

export function eventItemId(eventId: string): string {
  return `event:${eventId}`;
}

export function buildCapoeiraStartItem(
  target: User,
): CapoeiraStartTimelineItemDto {
  return {
    id: capoeiraStartId(target.id),
    category: CareerTimelineCategory.CAPOEIRA_START,
    occurredOn: toDateOnly(target.capoeiraStartedAt!),
    title: 'Started Capoeira',
    description: null,
  };
}

export function buildFormalGroupJoinedItem(
  affiliation: FormalGroupAffiliation,
): FormalGroupJoinedTimelineItemDto {
  return {
    id: formalGroupJoinedId(affiliation.id),
    category: CareerTimelineCategory.FORMAL_GROUP_JOINED,
    occurredOn: toDateOnly(affiliation.startedOn!),
    title: affiliation.group.name,
    description: null,
    group: { groupId: affiliation.group.id, name: affiliation.group.name },
  };
}

export function buildFormalGroupLeftItem(
  affiliation: FormalGroupAffiliation,
): FormalGroupLeftTimelineItemDto {
  return {
    id: formalGroupLeftId(affiliation.id),
    category: CareerTimelineCategory.FORMAL_GROUP_LEFT,
    occurredOn: toDateOnly(affiliation.endedOn!),
    title: affiliation.group.name,
    description: null,
    group: { groupId: affiliation.group.id, name: affiliation.group.name },
  };
}

export function buildFormalRankItem(
  assignment: FormalRankAssignment,
): FormalRankTimelineItemDto {
  const rank = assignment.rank;
  const event = assignment.event;
  return {
    id: formalRankId(assignment.id),
    category: CareerTimelineCategory.FORMAL_RANK,
    occurredOn: toDateOnly(assignment.startedOn!),
    title: rank.name,
    description: null,
    rank: {
      assignmentId: assignment.id,
      rankId: rank.id,
      name: rank.name,
      track: rank.track,
      cordSegments: [...rank.cordSegments.getItems()]
        .sort((a, b) => a.position - b.position)
        .map((segment) => ({
          position: segment.position,
          colorHex: segment.colorHex,
          proportion: segment.proportion,
        })),
      sourceGroup: {
        id: assignment.sourceGroup.id,
        name: assignment.sourceGroup.name,
      },
      awardedByName: assignment.awardedByName,
      startedOn: toDateOnly(assignment.startedOn!),
    },
    event: event
      ? {
          eventId: event.id,
          title: event.name,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
        }
      : null,
  };
}

export function buildEventItem(event: Event): EventTimelineItemDto {
  return {
    id: eventItemId(event.id),
    category: CareerTimelineCategory.EVENT,
    occurredOn: toDateOnly(event.startsAt),
    title: event.name,
    description: event.description,
    event: {
      eventId: event.id,
      title: event.name,
      type: event.type,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      community: toEventCommunityRefDto(eventCommunity(event)),
      locationName: event.locationName,
      locationAddress: event.locationAddress,
    },
  };
}

export function buildCustomItem(
  entry: CareerTimelineEntry,
): CustomTimelineItemDto {
  return {
    id: entry.id,
    category: CareerTimelineCategory.CUSTOM,
    occurredOn: toDateOnly(entry.occurredOn),
    title: entry.title,
    description: entry.description,
  };
}
