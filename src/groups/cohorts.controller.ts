import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateCohortDto,
  createCohortSchema,
} from './dto/create-cohort.schema';
import { CohortResponseDto } from './dto/cohort-response.dto';
import {
  UpdateCohortDto,
  updateCohortSchema,
} from './dto/update-cohort.schema';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { CohortsService } from './cohorts.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Cohort always belongs to exactly one Group-kind entity (a root Group or a
// Section) and is never independently addressable - every route is nested
// under the owning entity, dual-mounted since Cohort can attach at any
// level, same structure as AcademiesController.
@Controller(['groups/:groupId/cohorts', 'sections/:sectionId/cohorts'])
@UseGuards(GroupPermissionsGuard)
export class CohortsController {
  constructor(private readonly cohortsService: CohortsService) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.COHORT_CREATE)
  create(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createCohortSchema)) dto: CreateCohortDto,
  ): Promise<CohortResponseDto> {
    return this.cohortsService.create(groupId ?? sectionId, dto);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.COHORT_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<CohortResponseDto[]> {
    return this.cohortsService.list(groupId ?? sectionId);
  }

  @Get(':cohortId')
  @RequireGroupPermission(GroupPermission.COHORT_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('cohortId', ParseUUIDPipe) cohortId: string,
  ): Promise<CohortResponseDto> {
    return this.cohortsService.getById(groupId ?? sectionId, cohortId);
  }

  @Patch(':cohortId')
  @RequireGroupPermission(GroupPermission.COHORT_EDIT)
  update(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('cohortId', ParseUUIDPipe) cohortId: string,
    @Body(new ZodValidationPipe(updateCohortSchema)) dto: UpdateCohortDto,
  ): Promise<CohortResponseDto> {
    return this.cohortsService.update(groupId ?? sectionId, cohortId, dto);
  }

  @Post(':cohortId/archive')
  @RequireGroupPermission(GroupPermission.COHORT_ARCHIVE)
  archive(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('cohortId', ParseUUIDPipe) cohortId: string,
  ): Promise<CohortResponseDto> {
    return this.cohortsService.archive(groupId ?? sectionId, cohortId);
  }
}
