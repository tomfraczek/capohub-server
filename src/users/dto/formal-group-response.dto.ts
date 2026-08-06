// PUT /users/me/formal-group response.
export interface FormalGroupResponseDto {
  groupId: string;
  name: string;
  startedOn: string | null;
  endedOn: string | null;
}
