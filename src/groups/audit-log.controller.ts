import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
// type. Dual-mounted since every action is logged under its *exact*
// Group-or-Section, never a resolved root (see AuditLogEntry's own dual-FK
// comment and AuditLogService.record) - a Section-level action (e.g.
// BAN/SUSPEND, which only ever happen on a Section) only ever appears in
// that Section's own audit log, never its parent Group's.
@Controller(['groups/:groupId/audit-log', 'sections/:sectionId/audit-log'])
@UseGuards(GroupPermissionsGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequireGroupPermission(GroupPermission.AUDIT_LOG_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQueryDto,
  ): Promise<PaginatedResponse<AuditLogEntryResponseDto>> {
    return this.auditLogService.list(groupId ?? sectionId, query);
  }
}
