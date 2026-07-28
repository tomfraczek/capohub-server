import { EventStatus } from '../enums/event-status.enum';

export interface EventStatusHistoryResponseDto {
  id: string;
  eventId: string;
  fromStatus: EventStatus | null;
  toStatus: EventStatus;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}
