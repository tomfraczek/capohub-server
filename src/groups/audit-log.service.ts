import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { User } from '../users/entities/user.entity';
import {
  AuditLogEntryResponseDto,
  AuditLogEntryTargetRefDto,
} from './dto/audit-log-entry-response.dto';
import { AuditLogQuery } from './dto/audit-log-query.schema';
import { AuditLogEntry } from './entities/audit-log-entry.entity';
import { Group } from './entities/group.entity';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';

export interface RecordAuditEntryParams {
  community: Group | string;
  action: AuditAction;
  // null only for a hypothetical future system-initiated entry - every
  // current caller passes the actor performing the action.
  actor: User | null;
  targetType?: AuditTargetType;
  targetId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// The single write path for every Community Audit Log entry (see
// AuditLogEntry) - one generic `record()` call per action, never a
// dedicated method per action type, so the 21 call sites across
// GroupsService/GroupMembershipsService/RoleAssignmentsService/
// MembershipRequestsService all funnel through the same, simple API.
//
// `record()` always takes the caller's own EntityManager (never `this.em`
// directly) so it participates in whatever transaction the calling mutation
// is already running in - an entry is only ever persisted if the action it
// describes actually committed successfully (no orphaned log entries for a
// rolled-back mutation).
@Injectable()
export class AuditLogService {
  constructor(private readonly em: EntityManager) {}

  // Not async: persisting is synchronous (MikroORM's UnitOfWork just tracks
  // the entity) - flushing is always the caller's own responsibility (see
  // below), so there is nothing here to await. Callers may still `await`
  // this call without issue.
  record(em: EntityManager, params: RecordAuditEntryParams): void {
    const entry = new AuditLogEntry();
    entry.community =
      typeof params.community === 'string'
        ? em.getReference(Group, params.community)
        : params.community;
    entry.action = params.action;
    entry.actor = params.actor;
    entry.targetType = params.targetType ?? null;
    entry.targetId = params.targetId ?? null;
    entry.description = params.description ?? null;
    entry.metadata = params.metadata ?? null;
    em.persist(entry);
    // Flushed by the caller's own transaction - never flushes independently
    // here, so a failure later in the same transaction still rolls the
    // entry back with everything else.
  }

  async list(
    communityId: string,
    query: AuditLogQuery,
  ): Promise<PaginatedResponse<AuditLogEntryResponseDto>> {
    const where: Record<string, unknown> = { community: communityId };
    if (query.action) {
      where.action = query.action;
    }
    if (query.actorId) {
      where.actor = query.actorId;
    }

    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const field = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort;

    const [entries, totalItems] = await this.em.findAndCount(
      AuditLogEntry,
      where,
      {
        populate: ['actor'],
        orderBy: { [field]: direction },
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      },
    );

    return {
      data: entries.map(toAuditLogEntryResponseDto),
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems,
      }),
    };
  }
}

function toAuditLogEntryResponseDto(
  entry: AuditLogEntry,
): AuditLogEntryResponseDto {
  const target: AuditLogEntryTargetRefDto | null =
    entry.targetType && entry.targetId
      ? { type: entry.targetType, id: entry.targetId }
      : null;

  return {
    id: entry.id,
    communityId: entry.community.id,
    action: entry.action,
    actor: entry.actor
      ? { id: entry.actor.id, displayName: entry.actor.displayName }
      : null,
    target,
    description: entry.description,
    metadata: entry.metadata,
    createdAt: entry.createdAt.toISOString(),
  };
}
