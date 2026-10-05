import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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
import { GraduationSystemResponseDto } from './dto/graduation-system-response.dto';
import { PublicGraduationSystemResponseDto } from './dto/public-graduation-system-response.dto';
import { GraduationSystemService } from './graduation-system.service';
import { RanksService } from './ranks.service';

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
    private readonly ranksService: RanksService,
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

  // The public read of the catalog for the Group's profile - deliberately
  // gated by GROUP_VIEW (the same permission as GET /groups/:id, so it
  // works for a public Group's stranger too, via PUBLIC_VIEW_SAFE_PERMISSIONS),
  // never by GRADUATION_SYSTEM_VIEW: reading the gradation is public
  // information about the Group, managing it stays OWNER/ADMIN-only above/
  // below and in RanksController. Returns two empty tracks (never 404) for
  // a Group without a system - see PublicGraduationSystemResponseDto.
  @Get('public')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  getPublic(
    @Param('groupId') groupId: string,
  ): Promise<PublicGraduationSystemResponseDto> {
    return this.ranksService.listPublic(groupId);
  }

  // No body - the system has no settings of its own (see
  // graduation-system.entity.ts). There is deliberately no PATCH any more:
  // its only writable field was the since-dropped `name`.
  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.GRADUATION_SYSTEM_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  create(
    @Param('groupId') groupId: string,
    @CurrentUser() user: User,
  ): Promise<GraduationSystemResponseDto> {
    return this.graduationSystemService.create(groupId, user);
  }
}
