import { GroupMembership } from '../entities/group-membership.entity';
import { Group } from '../entities/group.entity';
import { GroupResponseDto } from '../dto/group-response.dto';
import { GroupMembershipResponseDto } from '../dto/group-membership-response.dto';
import { GroupRole } from '../enums/group-role.enum';
import { GroupSummaryResponseDto } from '../dto/group-summary-response.dto';

export function toGroupResponseDto(group: Group): GroupResponseDto {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    logoUrl: group.logoUrl,
    coverImageUrl: group.coverImageUrl,
    contactEmail: group.contactEmail,
    contactPhone: group.contactPhone,
    websiteUrl: group.websiteUrl,
    facebookUrl: group.facebookUrl,
    instagramUrl: group.instagramUrl,
    youtubeUrl: group.youtubeUrl,
    visibility: group.visibility,
    status: group.status,
    timezone: group.timezone,
    currencyCode: group.currencyCode,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export function toGroupSummaryResponseDto(
  group: Group,
  myRole: GroupRole,
): GroupSummaryResponseDto {
  return {
    id: group.id,
    name: group.name,
    logoUrl: group.logoUrl,
    visibility: group.visibility,
    status: group.status,
    myRole,
  };
}

export function toGroupMembershipResponseDto(
  membership: GroupMembership,
): GroupMembershipResponseDto {
  return {
    id: membership.id,
    user: {
      id: membership.user.id,
      displayName: membership.user.displayName,
    },
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    leftAt: membership.leftAt ? membership.leftAt.toISOString() : null,
  };
}
