import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { EventStatusHistoryResponseDto } from './dto/event-status-history-response.dto';
import { EventStatusHistory } from './entities/event-status-history.entity';
import { toEventStatusHistoryResponseDto } from './mappers/event-status-history.mapper';

// Read-only access to an Event's append-only lifecycle log (see
// event-status-history.entity.ts) - kept as its own tiny service rather
// than folded into EventsService, since it has no write operations of its
// own (every write happens as a side effect of EventsService's status
// transitions).
@Injectable()
export class EventHistoryService {
  constructor(private readonly em: EntityManager) {}

  async list(eventId: string): Promise<EventStatusHistoryResponseDto[]> {
    const entries = await this.em.find(
      EventStatusHistory,
      { event: eventId },
      { populate: ['actor'], orderBy: { createdAt: 'asc' } },
    );
    return entries.map(toEventStatusHistoryResponseDto);
  }
}
