import { Cohort } from '../entities/cohort.entity';
import { CohortResponseDto } from '../dto/cohort-response.dto';

export function toCohortResponseDto(cohort: Cohort): CohortResponseDto {
  return {
    id: cohort.id,
    // `group`/`section` are the two nullable halves of Cohort's
    // Group-or-Section reference (see cohort.entity.ts) - exactly one is
    // ever set.
    groupId: (cohort.group ?? cohort.section)!.id,
    name: cohort.name,
    description: cohort.description,
    status: cohort.status,
    createdAt: cohort.createdAt.toISOString(),
    updatedAt: cohort.updatedAt.toISOString(),
  };
}
