export interface EventGuardianAssignmentResponseDto {
  id: string;
  eventId: string;
  attendeeId: string;
  guardianUserId: string;
  assignedByUserId: string;
  assignedAt: string;
  revokedAt: string | null;
}
