import { AuditAction } from '../enums/audit-action.enum';
import { AuditTargetType } from '../enums/audit-target-type.enum';

export interface AuditLogEntryUserRefDto {
  id: string;
  displayName: string;
}

export interface AuditLogEntryTargetRefDto {
  type: AuditTargetType;
  id: string;
}

export interface AuditLogEntryResponseDto {
  id: string;
  communityId: string;
  action: AuditAction;
  // null only for a hypothetical future system-initiated entry - every
  // action this module currently logs is actor-initiated (see
  // AuditLogService.record).
  actor: AuditLogEntryUserRefDto | null;
  target: AuditLogEntryTargetRefDto | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
