import { Cohort } from '../entities/cohort.entity';
import { CohortResponseDto } from '../dto/cohort-response.dto';

export function toCohortResponseDto(cohort: Cohort): CohortResponseDto {
  return {
    id: cohort.id,
    groupId: cohort.group.id,
    name: cohort.name,
    description: cohort.description,
    status: cohort.status,
    createdAt: cohort.createdAt.toISOString(),
    updatedAt: cohort.updatedAt.toISOString(),
  };
}
