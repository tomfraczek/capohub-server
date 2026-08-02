import { Group } from '../entities/group.entity';
import { Community } from '../group-hierarchy.service';
import { MembershipRequestResponseDto } from '../dto/membership-request-response.dto';
import {
  CommunityHomeCommunityDto,
  CommunityHomeCommunityRefDto,
  CommunityHomeInvitationDto,
  CommunityHomeJoinRequestDto,
} from '../dto/community-home-response.dto';
import { GroupRole } from '../enums/group-role.enum';

// Type-based, not a `parentGroup === null` check - see the
// organizational-domain rebuild, stage 1: a Section is never "root"
// regardless of whether it currently has a parent.
function isRootGroup(community: Community): boolean {
  return community instanceof Group && community.parentGroup === null;
}

export function toCommunityHomeCommunityRefDto(
  community: Community,
): CommunityHomeCommunityRefDto {
  return {
    id: community.id,
    name: community.name,
    logoUrl: community.logoUrl,
    isRootGroup: isRootGroup(community),
  };
}

export function toCommunityHomeCommunityDto(
  community: Community,
  rootGroupId: string,
  myRoles: GroupRole[],
): CommunityHomeCommunityDto {
  return {
    id: community.id,
    name: community.name,
    description: community.description,
    logoUrl: community.logoUrl,
    coverImageUrl: community.coverImageUrl,
    parentId: community.parentGroup ? community.parentGroup.id : null,
    rootGroupId,
    isRootGroup: isRootGroup(community),
    myRoles,
    isPublic: community.isPublic,
    isHidden: community.isHidden,
    status: community.status,
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
