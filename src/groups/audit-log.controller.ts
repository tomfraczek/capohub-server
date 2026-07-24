import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuditLogService } from './audit-log.service';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { AuditLogEntryResponseDto } from './dto/audit-log-entry-response.dto';
import {
  AuditLogQueryDto,
  auditLogQuerySchema,
} from './dto/audit-log-query.schema';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// One generic, paginated/filterable/sortable list endpoint for every
// AuditAction (see AuditLogEntry) - never a dedicated endpoint per action
// type. `:groupId` here always means the Organization (Root Group) whose
// history is being read - AuditLogEntry.community is always a Root Group,
// even for entries about a Child Group action (see AuditLogEntry).
@Controller('groups/:groupId/audit-log')
@UseGuards(GroupPermissionsGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequireGroupPermission(GroupPermission.AUDIT_LOG_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQueryDto,
  ): Promise<PaginatedResponse<AuditLogEntryResponseDto>> {
    return this.auditLogService.list(groupId, query);
  }
}
