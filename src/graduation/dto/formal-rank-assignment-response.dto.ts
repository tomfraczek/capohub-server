import { RankTrack } from '../enums/rank-track.enum';
import { CordSegmentResponseDto } from './rank-response.dto';

// A snapshot-shaped reference to the catalog Rank this assignment points
// to. Every FormalRankAssignment points at a catalog Rank - there is no
// "custom" variant (see formal-rank-assignment.entity.ts) - so, unlike the
// original design, there is no `type` discriminator here.
export interface FormalRankRefDto {
  id: string;
  name: string;
  track: RankTrack;
  description: string | null;
  isArchived: boolean;
  cordSegments: CordSegmentResponseDto[];
}

export interface FormalRankSourceGroupRefDto {
  id: string;
  name: string;
}

// Never exposes internal history bookkeeping (row ids of the underlying
// FormalGroupAffiliation, role data, etc.) - see the module spec. Never
// describes a CustomUserRank - see the module spec's naming rule ("Nie
// nazywaj custom cordão formalnym rankiem w DTO ani komunikatach
// domenowych").
export interface FormalRankAssignmentResponseDto {
  id: string;
  rank: FormalRankRefDto;
  sourceGroup: FormalRankSourceGroupRefDto;
  startedOn: string | null;
  endedOn: string | null;
  awardedByName: string | null;
  isCurrent: boolean;
}
