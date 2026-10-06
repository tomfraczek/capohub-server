import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  GroupKind,
  RequireGroupKind,
} from '../groups/decorators/require-group-kind.decorator';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  ApproveFormalRankRequestDto,
  approveFormalRankRequestSchema,
  RejectFormalRankRequestDto,
  rejectFormalRankRequestSchema,
} from './dto/decide-formal-rank-request.schema';
import {
  GroupFormalRankRequestResponseDto,
  OwnFormalRankRequestStateDto,
} from './dto/formal-rank-request-response.dto';
import { FormalRankRequestsService } from './formal-rank-requests.service';

// Ustawienia grupy > Moderacja > "Prośby o potwierdzenie stopnia" - the
// Group's OWNER/ADMIN (FORMAL_RANK_REQUEST_REVIEW) confirm or reject a
// member's declared rank in this Group's graduation system.
@Controller('groups/:groupId/formal-rank-requests')
@UseGuards(GroupPermissionsGuard)
@RequireGroupKind(GroupKind.ROOT)
export class GroupFormalRankRequestsController {
  constructor(
    private readonly formalRankRequestsService: FormalRankRequestsService,
  ) {}

  @Get()
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_REQUEST_REVIEW)
  list(
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<GroupFormalRankRequestResponseDto[]> {
    return this.formalRankRequestsService.listPendingForGroup(groupId);
  }

  @Post(':requestId/approve')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_REQUEST_REVIEW)
  approve(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(new ZodValidationPipe(approveFormalRankRequestSchema))
    dto: ApproveFormalRankRequestDto,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.formalRankRequestsService.approve(
      groupId,
      requestId,
      user,
      dto.rankId,
    );
  }

  @Post(':requestId/reject')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.FORMAL_RANK_REQUEST_REVIEW)
  reject(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(new ZodValidationPipe(rejectFormalRankRequestSchema))
    dto: RejectFormalRankRequestDto,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.formalRankRequestsService.reject(
      groupId,
      requestId,
      user,
      dto.reason,
    );
  }
}

// The caller's own pending rank request (if any) - shown next to, never
// instead of, their current rank in the Capoeira hub.
@Controller('users/me/formal-rank-request')
export class MyFormalRankRequestController {
  constructor(
    private readonly formalRankRequestsService: FormalRankRequestsService,
  ) {}

  @Get()
  getOwn(@CurrentUser() user: User): Promise<OwnFormalRankRequestStateDto> {
    return this.formalRankRequestsService.getOwnPending(user.id);
  }

  // "Wycofaj prośbę" - CANCELLED, kept as history; 404
  // FORMAL_RANK_REQUEST_NOT_FOUND when nothing is pending.
  @Delete()
  @HttpCode(204)
  withdraw(@CurrentUser() user: User): Promise<void> {
    return this.formalRankRequestsService.withdrawOwn(user);
  }
}
