import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CreateCohortInput } from './dto/create-cohort.schema';
import { CohortResponseDto } from './dto/cohort-response.dto';
import { UpdateCohortInput } from './dto/update-cohort.schema';
import { Group } from './entities/group.entity';
import { Cohort } from './entities/cohort.entity';
import { CohortStatus } from './enums/cohort-status.enum';
import { toCohortResponseDto } from './mappers/cohort.mapper';

// A Group works identically with zero Cohorts (see ADR-003) - this
// service has no logic that depends on whether any Cohort exists.
// Cohort existence/status of its *Group* is already enforced by
// GroupPermissionsGuard (via :groupId) before any handler here runs.
@Injectable()
export class CohortsService {
  constructor(private readonly em: EntityManager) {}

  async create(
    groupId: string,
    input: CreateCohortInput,
  ): Promise<CohortResponseDto> {
    const cohort = new Cohort();
    cohort.group = this.em.getReference(Group, groupId);
    this.applyFields(cohort, input);

    await this.em.persist(cohort).flush();
    return toCohortResponseDto(cohort);
  }

  async list(groupId: string): Promise<CohortResponseDto[]> {
    const cohorts = await this.em.find(
      Cohort,
      { group: groupId },
      { orderBy: { createdAt: 'asc' } },
    );
    return cohorts.map(toCohortResponseDto);
  }

  async getById(groupId: string, cohortId: string): Promise<CohortResponseDto> {
    const cohort = await this.loadOrFail(groupId, cohortId);
    return toCohortResponseDto(cohort);
  }

  async update(
    groupId: string,
    cohortId: string,
    input: UpdateCohortInput,
  ): Promise<CohortResponseDto> {
    const cohort = await this.loadOrFail(groupId, cohortId);
    this.assertIsWritable(cohort);
    this.applyFields(cohort, input);
    await this.em.flush();
    return toCohortResponseDto(cohort);
  }

  async archive(groupId: string, cohortId: string): Promise<CohortResponseDto> {
    const cohort = await this.loadOrFail(groupId, cohortId);
    this.assertIsWritable(cohort);
    cohort.status = CohortStatus.ARCHIVED;
    await this.em.flush();
    return toCohortResponseDto(cohort);
  }

  private assertIsWritable(cohort: Cohort): void {
    if (cohort.status === CohortStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'COHORT_ARCHIVED',
        message:
          'This cohort is archived and is read-only until it is restored',
      });
    }
  }

  private applyFields(cohort: Cohort, input: CreateCohortInput): void {
    cohort.name = input.name;
    cohort.description = input.description;
  }

  private async loadOrFail(groupId: string, cohortId: string): Promise<Cohort> {
    const cohort = await this.em.findOne(
      Cohort,
      { id: cohortId, group: groupId },
      { populate: ['group'] },
    );
    if (!cohort) {
      throw new NotFoundException({
        code: 'COHORT_NOT_FOUND',
        message: 'Cohort not found',
      });
    }
    return cohort;
  }
}
