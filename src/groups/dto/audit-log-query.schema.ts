import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { uuidQuerySchema } from '../../common/validation/query.schemas';
import { AuditAction } from '../enums/audit-action.enum';

export const AUDIT_LOG_SORT_VALUES = ['createdAt', '-createdAt'] as const;

// Filtering: action and actorId, each optional and independently applied
// (AND semantics if both are given) - no free-text search, since the log
// is meant to be browsed by "what happened" / "who did it", not searched
// by description text.
export const auditLogQuerySchema = paginationQuerySchema.extend({
  action: z.nativeEnum(AuditAction).optional(),
  actorId: uuidQuerySchema.optional(),
  sort: z.enum(AUDIT_LOG_SORT_VALUES).default('-createdAt'),
});

export class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
