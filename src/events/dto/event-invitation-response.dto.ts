import { EventInvitationStatus } from '../enums/event-invitation-status.enum';

export interface EventInvitationResponseDto {
  id: string;
  eventId: string;
  invitedByUserId: string;
  invitedUserId: string | null;
  invitedEmail: string | null;
  status: EventInvitationStatus;
  createdAt: string;
  respondedAt: string | null;
}
