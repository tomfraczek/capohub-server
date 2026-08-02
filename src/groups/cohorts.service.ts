import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CreateCohortInput } from './dto/create-cohort.schema';
import { CohortResponseDto } from './dto/cohort-response.dto';
import { UpdateCohortInput } from './dto/update-cohort.schema';
import { Section } from './entities/section.entity';
import { Cohort } from './entities/cohort.entity';
import { CohortStatus } from './enums/cohort-status.enum';
import {
  communityIdFilter,
  GroupHierarchyService,
} from './group-hierarchy.service';
import { toCohortResponseDto } from './mappers/cohort.mapper';

// A Group works identically with zero Cohorts (see ADR-003) - this
// service has no logic that depends on whether any Cohort exists.
// Cohort existence/status of its *Group-or-Section* is already enforced by
// GroupPermissionsGuard (via :groupId/:sectionId) before any handler here
// runs.
@Injectable()
export class CohortsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  async create(
    groupId: string,
    input: CreateCohortInput,
  ): Promise<CohortResponseDto> {
    const community =
      await this.groupHierarchyService.findCommunityById(groupId);
    if (!community) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const cohort = new Cohort();
    if (community instanceof Section) {
      cohort.section = community;
    } else {
      cohort.group = community;
    }
    this.applyFields(cohort, input);

    await this.em.persist(cohort).flush();
    return toCohortResponseDto(cohort);
  }

  async list(groupId: string): Promise<CohortResponseDto[]> {
    const cohorts = await this.em.find(Cohort, communityIdFilter(groupId), {
      orderBy: { createdAt: 'asc' },
    });
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
      { id: cohortId, ...communityIdFilter(groupId) },
      { populate: ['group', 'section'] },
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
