import { Group } from '../entities/group.entity';
import { MembershipRequestResponseDto } from '../dto/membership-request-response.dto';
import {
  CommunityHomeCommunityDto,
  CommunityHomeCommunityRefDto,
  CommunityHomeInvitationDto,
  CommunityHomeJoinRequestDto,
} from '../dto/community-home-response.dto';
import { GroupRole } from '../enums/group-role.enum';

export function toCommunityHomeCommunityRefDto(
  group: Group,
): CommunityHomeCommunityRefDto {
  return {
    id: group.id,
    name: group.name,
    logoUrl: group.logoUrl,
    isRootGroup: group.parentGroup === null,
  };
}

export function toCommunityHomeCommunityDto(
  group: Group,
  rootGroupId: string,
  myRoles: GroupRole[],
): CommunityHomeCommunityDto {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    logoUrl: group.logoUrl,
    coverImageUrl: group.coverImageUrl,
    parentGroupId: group.parentGroup ? group.parentGroup.id : null,
    rootGroupId,
    isRootGroup: group.parentGroup === null,
    myRoles,
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    status: group.status,
  };
}

export function toCommunityHomeInvitationDto(
  request: MembershipRequestResponseDto,
  community: CommunityHomeCommunityRefDto,
): CommunityHomeInvitationDto {
  return {
    id: request.id,
    community,
    inviter: request.initiatedBy,
    targetType: request.targetType,
    status: request.status,
    createdAt: request.createdAt,
  };
}

export function toCommunityHomeJoinRequestDto(
  request: MembershipRequestResponseDto,
  community: CommunityHomeCommunityRefDto,
): CommunityHomeJoinRequestDto {
  return {
    id: request.id,
    community,
    requestedBy: request.initiatedBy,
    targetType: request.targetType,
    status: request.status,
    createdAt: request.createdAt,
  };
}
