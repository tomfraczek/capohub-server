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
import { AcademiesService } from './academies.service';
import {
  CreateAcademyDto,
  createAcademySchema,
} from './dto/create-academy.schema';
import { AcademyResponseDto } from './dto/academy-response.dto';
import {
  UpdateAcademyDto,
  updateAcademySchema,
} from './dto/update-academy.schema';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Academy always belongs to exactly one Group-kind entity (a root Group or
// a Section) and is never independently addressable - every route is
// nested under the owning entity, dual-mounted since Academy can attach at
// any level. GroupPermissionsGuard (generalized to also read :groupId/
// :sectionId, see its comment) enforces both membership/permission and the
// owner's own lifecycle status before any handler here runs.
@Controller(['groups/:groupId/academies', 'sections/:sectionId/academies'])
@UseGuards(GroupPermissionsGuard)
export class AcademiesController {
  constructor(private readonly academiesService: AcademiesService) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.ACADEMY_CREATE)
  create(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createAcademySchema)) dto: CreateAcademyDto,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.create(groupId ?? sectionId, dto);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.ACADEMY_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<AcademyResponseDto[]> {
    return this.academiesService.list(groupId ?? sectionId);
  }

  @Get(':academyId')
  @RequireGroupPermission(GroupPermission.ACADEMY_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('academyId', ParseUUIDPipe) academyId: string,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.getById(groupId ?? sectionId, academyId);
  }

  @Patch(':academyId')
  @RequireGroupPermission(GroupPermission.ACADEMY_EDIT)
  update(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('academyId', ParseUUIDPipe) academyId: string,
    @Body(new ZodValidationPipe(updateAcademySchema)) dto: UpdateAcademyDto,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.update(groupId ?? sectionId, academyId, dto);
  }

  @Post(':academyId/archive')
  @RequireGroupPermission(GroupPermission.ACADEMY_ARCHIVE)
  archive(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('academyId', ParseUUIDPipe) academyId: string,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.archive(groupId ?? sectionId, academyId);
  }
}
