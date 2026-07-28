import { EventGuardianAssignmentResponseDto } from '../dto/event-guardian-response.dto';
import { EventGuardianAssignment } from '../entities/event-guardian-assignment.entity';

export function toEventGuardianAssignmentResponseDto(
  assignment: EventGuardianAssignment,
): EventGuardianAssignmentResponseDto {
  return {
    id: assignment.id,
    eventId: assignment.event.id,
    attendeeId: assignment.attendee.id,
    guardianUserId: assignment.guardian.id,
    assignedByUserId: assignment.assignedBy.id,
    assignedAt: assignment.assignedAt.toISOString(),
    revokedAt: assignment.revokedAt?.toISOString() ?? null,
  };
}
