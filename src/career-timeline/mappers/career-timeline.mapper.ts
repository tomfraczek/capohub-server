import { CustomUserRank } from '../../graduation/entities/custom-user-rank.entity';
import { eventCommunity } from '../../events/event-community.util';
import { Event } from '../../events/entities/event.entity';
import { toEventCommunityRefDto } from '../../events/mappers/event-community-ref.mapper';
import { FormalGroupAffiliation } from '../../groups/entities/formal-group-affiliation.entity';
import { FormalRankAssignment } from '../../graduation/entities/formal-rank-assignment.entity';
import { Group } from '../../groups/entities/group.entity';
import { RoleAssignment } from '../../groups/entities/role-assignment.entity';
import { Section } from '../../groups/entities/section.entity';
import { PublicUrlBuilder } from '../../storage/image-url.util';
import { User } from '../../users/entities/user.entity';
import { CareerTimelineEntry } from '../entities/career-timeline-entry.entity';
import {
  CareerTimelineEntryType,
  CareerTimelineOrigin,
  CareerTimelinePrecision,
} from '../enums/career-timeline-entry-type.enum';
import {
  CareerTimelineEventRefDto,
  CareerTimelineGroupRefDto,
  CareerTimelineItemDto,
  CareerTimelineSectionRefDto,
} from '../dto/career-timeline-item.dto';

// MikroORM's postgres driver returns a `date` column as a plain
// "YYYY-MM-DD" string at runtime despite the entity's TS type - same
// normalization as UserProfileMapper.toDateOnly / FormalRankAssignmentMapper.toDateOnly.
export function toDateOnly(date: Date | string): string {
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}

export function startTrainingId(userId: string): string {
  return `start-training:${userId}`;
}

export function joinedGroupId(affiliationId: string): string {
  return `joined-group:${affiliationId}`;
}

export function leftGroupId(affiliationId: string): string {
  return `left-group:${affiliationId}`;
}

export function receivedRankId(assignmentId: string): string {
  return `received-rank:${assignmentId}`;
}

export function independentRankId(customRankId: string): string {
  return `independent-rank:${customRankId}`;
}

export function startedTeachingId(roleAssignmentId: string): string {
  return `started-teaching:${roleAssignmentId}`;
}

export function startedSectionId(sectionId: string): string {
  return `started-section:${sectionId}`;
}

export function foundedGroupId(groupId: string): string {
  return `founded-group:${groupId}`;
}

function groupRef(group: Group): CareerTimelineGroupRefDto {
  return { groupId: group.id, name: group.name };
}

function sectionRef(section: Section): CareerTimelineSectionRefDto {
  return { sectionId: section.id, name: section.name };
}

export function eventRef(
  event: Event,
  urlBuilder: PublicUrlBuilder,
): CareerTimelineEventRefDto {
  return {
    eventId: event.id,
    title: event.name,
    type: event.type,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    community: toEventCommunityRefDto(eventCommunity(event), urlBuilder),
    locationName: event.locationName,
  };
}

function systemBase(
  id: string,
  type: CareerTimelineEntryType,
  occurredOn: Date | string,
  title: string,
): Pick<
  CareerTimelineItemDto,
  | 'id'
  | 'type'
  | 'origin'
  | 'occurredOn'
  | 'occurredOnPrecision'
  | 'title'
  | 'description'
  | 'editable'
  | 'possibleDuplicateOfId'
> {
  return {
    id,
    type,
    origin: CareerTimelineOrigin.SYSTEM,
    occurredOn: toDateOnly(occurredOn),
    // Every SYSTEM item comes from a real recorded timestamp, never a
    // user-remembered partial date.
    occurredOnPrecision: CareerTimelinePrecision.DAY,
    title,
    description: null,
    editable: false,
    // Only ever set on a MANUAL item - see
    // CareerTimelineAggregationService's post-processing pass.
    possibleDuplicateOfId: null,
  };
}

export function buildStartTrainingItem(target: User): CareerTimelineItemDto {
  return {
    ...systemBase(
      startTrainingId(target.id),
      CareerTimelineEntryType.START_TRAINING,
      target.capoeiraStartedAt!,
      'Rozpoczęcie treningów Capoeira',
    ),
    group: null,
    section: null,
    event: null,
    apelido: null,
    rankName: null,
    awardedByName: null,
    location: null,
    rankDetails: null,
  };
}

export function buildJoinedGroupItem(
  affiliation: FormalGroupAffiliation,
): CareerTimelineItemDto {
  return {
    ...systemBase(
      joinedGroupId(affiliation.id),
      CareerTimelineEntryType.JOINED_GROUP,
      affiliation.startedOn!,
      `Dołączenie do ${affiliation.group.name}`,
    ),
    group: groupRef(affiliation.group),
    section: null,
    event: null,
    apelido: null,
    rankName: null,
    awardedByName: null,
    location: null,
    rankDetails: null,
  };
}

export function buildLeftGroupItem(
  affiliation: FormalGroupAffiliation,
): CareerTimelineItemDto {
  return {
    ...systemBase(
      leftGroupId(affiliation.id),
      CareerTimelineEntryType.LEFT_GROUP,
      affiliation.endedOn!,
      `Odejście z ${affiliation.group.name}`,
    ),
    group: groupRef(affiliation.group),
    section: null,
    event: null,
    apelido: null,
    rankName: null,
    awardedByName: null,
    location: null,
    rankDetails: null,
  };
}

export function buildReceivedRankItem(
  assignment: FormalRankAssignment,
  urlBuilder: PublicUrlBuilder,
  // false when a non-owner viewer isn't allowed to see the linked Event's
  // own details (EventAccessService.isVisibleToViewer) - the rank fact
  // itself still shows, only the Event evidence is withheld (redesign
  // audit §3: a career-timeline item must never leak a private Event's
  // details to a viewer who has no access to it).
  includeEvent = true,
): CareerTimelineItemDto {
  const rank = assignment.rank;
  const event = assignment.event;
  return {
    ...systemBase(
      receivedRankId(assignment.id),
      CareerTimelineEntryType.RECEIVED_RANK,
      assignment.startedOn!,
      `Otrzymanie stopnia ${rank.name}`,
    ),
    group: groupRef(assignment.sourceGroup),
    section: null,
    event: event && includeEvent ? eventRef(event, urlBuilder) : null,
    apelido: null,
    rankName: rank.name,
    awardedByName: assignment.awardedByName,
    location: null,
    rankDetails: {
      assignmentId: assignment.id,
      rankId: rank.id,
      source: 'FORMAL_GROUP',
      track: rank.track,
      cordSegments: [...rank.cordSegments.getItems()]
        .sort((a, b) => a.position - b.position)
        .map((segment) => ({
          position: segment.position,
          colorHex: segment.colorHex,
          proportion: segment.proportion,
        })),
    },
  };
}

// An independent-rank stint (CustomUserRank) - a real, earlier rank of the
// user that must stay in their history after it was replaced (e.g. by a
// rank confirmed in their new formal Group). Dated by startedOn, else by
// when it was declared in the app (createdAt) - an independent rank has no
// other recorded timestamp, and leaving it out would make it disappear.
export function buildIndependentRankItem(
  customRank: CustomUserRank,
): CareerTimelineItemDto {
  return {
    ...systemBase(
      independentRankId(customRank.id),
      CareerTimelineEntryType.RECEIVED_RANK,
      customRank.startedOn ?? customRank.createdAt.toISOString().slice(0, 10),
      `Otrzymanie stopnia ${customRank.name}`,
    ),
    group: null,
    section: null,
    event: null,
    apelido: null,
    rankName: customRank.name,
    awardedByName: null,
    location: null,
    rankDetails: {
      assignmentId: customRank.id,
      rankId: null,
      source: 'INDEPENDENT',
      track: customRank.track,
      cordSegments: [...customRank.cordSegments.getItems()]
        .sort((a, b) => a.position - b.position)
        .map((segment) => ({
          position: segment.position,
          colorHex: segment.colorHex,
          proportion: segment.proportion,
        })),
    },
  };
}

export function buildStartedTeachingItem(
  roleAssignment: RoleAssignment,
): CareerTimelineItemDto {
  const section = roleAssignment.section!;
  return {
    ...systemBase(
      startedTeachingId(roleAssignment.id),
      CareerTimelineEntryType.STARTED_TEACHING,
      roleAssignment.grantedAt,
      'Rozpoczęcie prowadzenia treningów',
    ),
    group: section.parentGroup ? groupRef(section.parentGroup) : null,
    section: sectionRef(section),
    event: null,
    apelido: null,
    rankName: null,
    awardedByName: null,
    location: null,
    rankDetails: null,
  };
}

// Sourced from Section.founderUser + Section.createdAt (a permanent record
// set once at creation - see that field's own comment), not from
// RoleAssignment any more - a founder's RoleAssignment row can be
// physically deleted (account deletion) without this fact ceasing to be
// true. Only ever called for a Section where `founderUser` matches the
// timeline's own target user (see CareerTimelineAggregationService), so
// there is always a real founder here - the section param itself carries
// no opinion about *whose* timeline this is.
export function buildStartedSectionItem(
  section: Section,
): CareerTimelineItemDto {
  return {
    ...systemBase(
      startedSectionId(section.id),
      CareerTimelineEntryType.STARTED_SECTION,
      section.createdAt,
      section.city
        ? `Rozpoczęcie prowadzenia sekcji w ${section.city}`
        : 'Rozpoczęcie prowadzenia sekcji',
    ),
    group: section.parentGroup ? groupRef(section.parentGroup) : null,
    section: sectionRef(section),
    event: null,
    apelido: null,
    rankName: null,
    awardedByName: null,
    location: section.city,
    rankDetails: null,
  };
}

// Sourced from Group.founderUser + Group.createdAt - see
// buildStartedSectionItem's own comment for why this is no longer
// RoleAssignment-derived.
export function buildFoundedGroupItem(group: Group): CareerTimelineItemDto {
  return {
    ...systemBase(
      foundedGroupId(group.id),
      CareerTimelineEntryType.FOUNDED_GROUP,
      group.createdAt,
      `Założenie ${group.name}`,
    ),
    group: groupRef(group),
    section: null,
    event: null,
    apelido: null,
    rankName: null,
    awardedByName: null,
    location: null,
    rankDetails: null,
  };
}

export function buildManualItem(
  entry: CareerTimelineEntry,
  urlBuilder: PublicUrlBuilder,
  // false when a non-owner viewer isn't allowed to see the linked Event's
  // own details - see buildReceivedRankItem's own comment on why.
  includeEvent = true,
): CareerTimelineItemDto {
  return {
    id: entry.id,
    type: entry.type,
    origin: CareerTimelineOrigin.MANUAL,
    occurredOn: toDateOnly(entry.occurredOn),
    occurredOnPrecision: entry.occurredOnPrecision,
    title: entry.title,
    description: entry.description,
    group: entry.groupNameSnapshot
      ? { groupId: entry.group?.id ?? null, name: entry.groupNameSnapshot }
      : null,
    section: entry.sectionNameSnapshot
      ? {
          sectionId: entry.section?.id ?? null,
          name: entry.sectionNameSnapshot,
        }
      : null,
    // `eventId` is always a real CapoHub Event picked at creation time (see
    // the input schema - no free-text fallback) - the ref only degrades to
    // null if the relation itself goes null (deleteRule 'set null', a
    // defensive fallback that in practice never fires, since Events are
    // never hard-deleted) or the viewer lacks access. name/date/location
    // come from the snapshot taken when the Event was linked (redesign
    // audit §3), not the Event's current, possibly-since-edited values;
    // type/endsAt/organizer stay live-joined, since those are secondary and
    // Events are never hard-deleted, only edited.
    event:
      entry.event && includeEvent
        ? {
            ...eventRef(entry.event, urlBuilder),
            title: entry.eventNameSnapshot ?? entry.event.name,
            startsAt: (
              entry.eventStartsAtSnapshot ?? entry.event.startsAt
            ).toISOString(),
            locationName:
              entry.eventLocationNameSnapshot ?? entry.event.locationName,
          }
        : null,
    apelido: entry.apelido,
    rankName: entry.rankName,
    awardedByName: entry.awardedByName,
    location: entry.location,
    rankDetails: null,
    editable: true,
    // Computed by CareerTimelineAggregationService in a post-processing
    // pass over the full result set - never known at the level of a single
    // entry. Always null here; CareerTimelineEntriesService's own raw CRUD
    // responses (create/update/get/list) also leave it null, since they
    // never cross-reference SYSTEM items (redesign audit §2's hint is a
    // full-timeline-view feature, not a raw-entry-CRUD one).
    possibleDuplicateOfId: null,
  };
}
