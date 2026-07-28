import { EventStatusHistoryResponseDto } from '../dto/event-status-history-response.dto';
import { EventStatusHistory } from '../entities/event-status-history.entity';

export function toEventStatusHistoryResponseDto(
  entry: EventStatusHistory,
): EventStatusHistoryResponseDto {
  return {
    id: entry.id,
    eventId: entry.event.id,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorUserId: entry.actor?.id ?? null,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
  };
}
