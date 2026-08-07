import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AllowGroupStatuses } from '../groups/decorators/allow-group-statuses.decorator';
import {
  GroupKind,
  RequireGroupKind,
} from '../groups/decorators/require-group-kind.decorator';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { SectionMemberFormalRankResponseDto } from './dto/section-member-formal-rank-response.dto';
import { FormalRankCorrectionService } from './formal-rank-correction.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Section OWNER/ADMIN-only prep view for the formal-rank-correction
// workflow (module spec) - reuses GroupPermission.FORMAL_RANK_CORRECTION_VIEW
// rather than adding a new permission: this endpoint answers exactly the
// question that permission already exists to gate ("may this caller see
// this Section's formal-rank-correction affairs"), so a new capability
// would only duplicate it. Single-mounted with @RequireGroupKind(SECTION),
// same as FormalRankCorrectionsController - a Group id 404s here, and
// (since FORMAL_RANK_CORRECTION_VIEW is absent from
// GROUP_TARGET_ROLE_PERMISSIONS entirely - see
// group-role-permissions.map.ts) a parent Group's own OWNER/ADMIN gets no
// access through this route either - no inheritance.
@Controller('sections/:sectionId/members/:membershipId/formal-rank')
@UseGuards(GroupPermissionsGuard)
export class SectionMemberFormalRankController {
  constructor(
    private readonly formalRankCorrectionService: FormalRankCorrectionService,
  ) {}

  @Get()
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_CORRECTION_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  getMemberFormalRank(
    @Param('sectionId') sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<SectionMemberFormalRankResponseDto> {
    return this.formalRankCorrectionService.getMemberFormalRank(
      sectionId,
      membershipId,
    );
  }
}
