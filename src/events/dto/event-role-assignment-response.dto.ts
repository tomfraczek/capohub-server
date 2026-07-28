import { EventRole } from '../enums/event-role.enum';

export interface EventRoleAssignmentResponseDto {
  id: string;
  eventId: string;
  userId: string;
  role: EventRole;
  grantedAt: string;
  grantedByUserId: string | null;
}
