import { EventInvitationResponseDto } from '../dto/event-invitation-response.dto';
import { EventInvitation } from '../entities/event-invitation.entity';

export function toEventInvitationResponseDto(
  invitation: EventInvitation,
): EventInvitationResponseDto {
  return {
    id: invitation.id,
    eventId: invitation.event.id,
    invitedByUserId: invitation.invitedBy.id,
    invitedUserId: invitation.invitedUser?.id ?? null,
    invitedEmail: invitation.invitedEmail,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    respondedAt: invitation.respondedAt?.toISOString() ?? null,
  };
}
