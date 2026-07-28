import { EventRoleAssignmentResponseDto } from '../dto/event-role-assignment-response.dto';
import { EventRoleAssignment } from '../entities/event-role-assignment.entity';

export function toEventRoleAssignmentResponseDto(
  assignment: EventRoleAssignment,
): EventRoleAssignmentResponseDto {
  return {
    id: assignment.id,
    eventId: assignment.event.id,
    userId: assignment.user.id,
    role: assignment.role,
    grantedAt: assignment.grantedAt.toISOString(),
    grantedByUserId: assignment.grantedBy?.id ?? null,
  };
}
