import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AllowGroupStatuses } from '../groups/decorators/allow-group-statuses.decorator';
import {
  RequireGroupKind,
  GroupKind,
} from '../groups/decorators/require-group-kind.decorator';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { User } from '../users/entities/user.entity';
import {
  CreateGraduationSystemDto,
  createGraduationSystemSchema,
} from './dto/create-graduation-system.schema';
import { GraduationSystemResponseDto } from './dto/graduation-system-response.dto';
import {
  UpdateGraduationSystemDto,
  updateGraduationSystemSchema,
} from './dto/update-graduation-system.schema';
import { GraduationSystemService } from './graduation-system.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// A graduation catalog always belongs to exactly one root Group - never a
// Section (see the module spec: "Section nie definiuje własnego
// katalogu"), so this is single-mounted with @RequireGroupKind(ROOT),
// same as GroupsController's own :id routes - a Section id 404s here
// rather than being silently served.
@Controller('groups/:groupId/graduation-system')
@UseGuards(GroupPermissionsGuard)
export class GraduationSystemController {
  constructor(
    private readonly graduationSystemService: GraduationSystemService,
  ) {}

  @Get()
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  getByGroup(
    @Param('groupId') groupId: string,
  ): Promise<GraduationSystemResponseDto> {
    return this.graduationSystemService.getByGroup(groupId);
  }

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  create(
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(createGraduationSystemSchema))
    dto: CreateGraduationSystemDto,
    @CurrentUser() user: User,
  ): Promise<GraduationSystemResponseDto> {
    return this.graduationSystemService.create(groupId, dto, user);
  }

  @Patch()
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  update(
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(updateGraduationSystemSchema))
    dto: UpdateGraduationSystemDto,
    @CurrentUser() user: User,
  ): Promise<GraduationSystemResponseDto> {
    return this.graduationSystemService.update(groupId, dto, user);
  }
}
