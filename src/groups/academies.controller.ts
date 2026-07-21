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
] as const;

// Academy always belongs to exactly one Group and is never independently
// addressable - every route is nested under the owning Group, and
// GroupPermissionsGuard (generalized to also read :groupId, see its
// comment) enforces both membership/permission and the Group's own
// lifecycle status before any handler here runs.
@Controller('groups/:groupId/academies')
@UseGuards(GroupPermissionsGuard)
export class AcademiesController {
  constructor(private readonly academiesService: AcademiesService) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.ACADEMY_CREATE)
  create(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(createAcademySchema)) dto: CreateAcademyDto,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.create(groupId, dto);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.ACADEMY_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<AcademyResponseDto[]> {
    return this.academiesService.list(groupId);
  }

  @Get(':academyId')
  @RequireGroupPermission(GroupPermission.ACADEMY_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('academyId', ParseUUIDPipe) academyId: string,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.getById(groupId, academyId);
  }

  @Patch(':academyId')
  @RequireGroupPermission(GroupPermission.ACADEMY_EDIT)
  update(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('academyId', ParseUUIDPipe) academyId: string,
    @Body(new ZodValidationPipe(updateAcademySchema)) dto: UpdateAcademyDto,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.update(groupId, academyId, dto);
  }

  @Post(':academyId/archive')
  @RequireGroupPermission(GroupPermission.ACADEMY_ARCHIVE)
  archive(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('academyId', ParseUUIDPipe) academyId: string,
  ): Promise<AcademyResponseDto> {
    return this.academiesService.archive(groupId, academyId);
  }
}
