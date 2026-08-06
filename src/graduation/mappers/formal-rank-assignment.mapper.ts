import {
  FormalRankAssignmentResponseDto,
  FormalRankRefDto,
} from '../dto/formal-rank-assignment-response.dto';
import { FormalRankAssignment } from '../entities/formal-rank-assignment.entity';

// MikroORM's postgres driver returns a `date` column as a plain
// "YYYY-MM-DD" string at runtime despite the entity's TS type - same
// normalization as UserProfileMapper.toDateOnly.
function toDateOnly(date: Date | string | null): string | null {
  if (!date) {
    return null;
  }
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}

function toFormalRankRef(assignment: FormalRankAssignment): FormalRankRefDto {
  const rank = assignment.rank;
  return {
    id: rank.id,
    name: rank.name,
    track: rank.track,
    description: rank.description,
    isArchived: rank.isArchived,
    cordSegments: [...rank.cordSegments.getItems()]
      .sort((a, b) => a.position - b.position)
      .map((segment) => ({
        position: segment.position,
        colorHex: segment.colorHex,
        proportion: segment.proportion,
      })),
  };
}

export function toFormalRankAssignmentResponseDto(
  assignment: FormalRankAssignment,
): FormalRankAssignmentResponseDto {
  return {
    id: assignment.id,
    rank: toFormalRankRef(assignment),
    sourceGroup: {
      id: assignment.sourceGroup.id,
      name: assignment.sourceGroup.name,
    },
    startedOn: toDateOnly(assignment.startedOn),
    endedOn: toDateOnly(assignment.endedOn),
    awardedByName: assignment.awardedByName,
    isCurrent: assignment.endedOn === null,
  };
}
