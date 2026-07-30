import { User } from '../../users/entities/user.entity';
import { RecipientGroupResponseDto } from '../dto/recipient-group-response.dto';
import { RecipientGroup } from '../entities/recipient-group.entity';

export function toRecipientGroupResponseDto(
  recipientGroup: RecipientGroup,
  members: User[],
): RecipientGroupResponseDto {
  return {
    id: recipientGroup.id,
    groupId: recipientGroup.group.id,
    name: recipientGroup.name,
    isActive: recipientGroup.isActive,
    members: members
      .map((user) => ({ id: user.id, displayName: user.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    createdByUserId: recipientGroup.createdBy?.id ?? null,
    createdAt: recipientGroup.createdAt.toISOString(),
    updatedAt: recipientGroup.updatedAt.toISOString(),
  };
}
