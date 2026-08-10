import { NotificationResponseDto } from './notification-response.dto';

export interface NotificationListResponseDto {
  items: NotificationResponseDto[];
  total: number;
  hasMore: boolean;
}
