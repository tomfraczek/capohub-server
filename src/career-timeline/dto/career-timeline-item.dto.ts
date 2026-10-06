import { EventType } from '../../events/enums/event-type.enum';
import { EventCommunityRefDto } from '../../events/dto/event-community-ref.dto';
import { CordSegmentResponseDto } from '../../graduation/dto/rank-response.dto';
import { RankTrack } from '../../graduation/enums/rank-track.enum';
import {
  CareerTimelineEntryType,
  CareerTimelineOrigin,
  CareerTimelinePrecision,
} from '../enums/career-timeline-entry-type.enum';

// `groupId`/`sectionId` are null when the entry only ever had a free-text
// name (no matching CapoHub Group/Section was picked, or picked - see
// CareerTimelineEntriesService.resolveGroupRef) - `name` (the snapshot) is
// always present whenever the ref itself is present, regardless.
export interface CareerTimelineGroupRefDto {
  groupId: string | null;
  name: string;
}

export interface CareerTimelineSectionRefDto {
  sectionId: string | null;
  name: string;
}

// Deliberately smaller than a full EventResponseDto - this is a secondary
// evidence reference on a timeline item, not the item itself (EVENT is no
// longer a standalone category - see the aggregation service's own
// comment on why "every attended Event" was removed).
export interface CareerTimelineEventRefDto {
  eventId: string;
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  community: EventCommunityRefDto | null;
  locationName: string | null;
}

// Only ever populated on a SYSTEM RECEIVED_RANK item - built from a
// FormalRankAssignment (source FORMAL_GROUP, `group` = the Group whose
// system it is) or from an independent-rank stint (source INDEPENDENT,
// CustomUserRank - no catalog Rank, so `rankId` is null and `group` is
// null). A MANUAL RECEIVED_RANK entry has only the free-text `rankName`.
export interface CareerTimelineFormalRankDetailsDto {
  // The FormalRankAssignment's id, or the CustomUserRank's id.
  assignmentId: string;
  rankId: string | null;
  source: 'FORMAL_GROUP' | 'INDEPENDENT';
  track: RankTrack;
  cordSegments: CordSegmentResponseDto[];
}

// One flat, mostly-optional shape for every type/origin combination,
// rather than a 12-branch discriminated union - every extension field
// below is optional by construction (no type populates more than a handful
// of them), and the frontend already has to switch on `type` to decide
// what to render, same as it switches on a discriminant today. The write
// side (career-timeline-entry-input.schema.ts) stays a proper
// discriminated union - this DTO is read-only output.
export interface CareerTimelineItemDto {
  // Stable across reads - either a deterministic composite of source type +
  // source id (e.g. "formal-rank:<assignmentId>") for SYSTEM items, or the
  // CareerTimelineEntry's own UUID for MANUAL.
  id: string;
  type: CareerTimelineEntryType;
  origin: CareerTimelineOrigin;
  occurredOn: string;
  occurredOnPrecision: CareerTimelinePrecision;
  title: string;
  description: string | null;
  group: CareerTimelineGroupRefDto | null;
  section: CareerTimelineSectionRefDto | null;
  event: CareerTimelineEventRefDto | null;
  apelido: string | null;
  rankName: string | null;
  awardedByName: string | null;
  location: string | null;
  rankDetails: CareerTimelineFormalRankDetailsDto | null;
  // MANUAL only - whether the caller (always the owner, since only owners
  // ever see raw entries) may edit/delete this item. Always false for
  // SYSTEM - redundant with `origin === 'SYSTEM'` but saves every caller
  // from re-deriving the same check.
  editable: boolean;
  // MANUAL only - the id of a SYSTEM item this one might describe the same
  // real-world fact as (same type, same calendar period at this item's own
  // precision, no conflicting Group) - see
  // career-timeline-duplicate-detection.ts. Never auto-resolved: the
  // frontend surfaces this as a dismissible hint, nothing is merged or
  // deleted automatically (redesign audit §2). Always null for SYSTEM
  // items and for a MANUAL item with no match.
  possibleDuplicateOfId: string | null;
}
