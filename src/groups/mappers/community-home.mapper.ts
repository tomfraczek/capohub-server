import { Group } from '../entities/group.entity';
import { Community } from '../group-hierarchy.service';
import { MembershipRequestResponseDto } from '../dto/membership-request-response.dto';
import {
  PublicUrlBuilder,
  resolveImageUrl,
} from '../../storage/image-url.util';
import {
  CommunityHomeCommunityDto,
  CommunityHomeCommunityRefDto,
  CommunityHomeInvitationDto,
  CommunityHomeJoinRequestDto,
} from '../dto/community-home-response.dto';
import { GroupRole } from '../enums/group-role.enum';

export function toCommunityHomeCommunityRefDto(
  community: Community,
  urlBuilder: PublicUrlBuilder,
): CommunityHomeCommunityRefDto {
  return {
    id: community.id,
    name: community.name,
    // Prefers the R2 public URL derived from profileImageKey over the
    // legacy logoUrl column once an upload exists - see
    // storage/image-url.util.ts's resolveImageUrl.
    logoUrl: resolveImageUrl(
      community.profileImageKey,
      community.logoUrl,
      urlBuilder,
    ),
    isGroup: community instanceof Group,
  };
}

export function toCommunityHomeCommunityDto(
  community: Community,
  rootGroupId: string,
  myRoles: GroupRole[],
  urlBuilder: PublicUrlBuilder,
): CommunityHomeCommunityDto {
  return {
    id: community.id,
    name: community.name,
    description: community.description,
    logoUrl: resolveImageUrl(
      community.profileImageKey,
      community.logoUrl,
      urlBuilder,
    ),
    // No R2 cover upload for Group/Section (module spec) - stays a plain
    // legacy passthrough.
    coverImageUrl: community.coverImageUrl,
    parentId: community.parentGroup ? community.parentGroup.id : null,
    rootGroupId,
    isGroup: community instanceof Group,
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
