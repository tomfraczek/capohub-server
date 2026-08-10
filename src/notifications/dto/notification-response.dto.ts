import { NotificationCategory } from '../enums/notification-category.enum';
import { NotificationTargetType } from '../enums/notification-target-type.enum';
import { NotificationType } from '../enums/notification-type.enum';

export interface NotificationResponseDto {
  id: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body: string;
  targetType: NotificationTargetType | null;
  targetId: string | null;
  contextGroupId: string | null;
  contextSectionId: string | null;
  readAt: string | null;
  createdAt: string;
}
