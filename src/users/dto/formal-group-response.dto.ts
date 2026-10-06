import { MembershipRequestResponseDto } from '../../groups/dto/membership-request-response.dto';

// PUT /users/me/formal-group response.
export interface FormalGroupResponseDto {
  groupId: string;
  name: string;
  startedOn: string | null;
  endedOn: string | null;
}

// PUT /users/me/formal-group response (HTTP 202) when the Group's
// joinRequiresApproval is on: nothing changed yet - a Group join request now
// waits for the Group's OWNER/ADMIN (see UserProfileService.setFormalGroup).
export interface PendingFormalGroupRequestResponseDto {
  pendingRequest: MembershipRequestResponseDto;
}
