import { GroupMembership } from '../entities/group-membership.entity';
import { Group } from '../entities/group.entity';
import { RoleAssignment } from '../entities/role-assignment.entity';
import { Section } from '../entities/section.entity';
import { GroupResponseDto } from '../dto/group-response.dto';
import { GroupMembershipResponseDto } from '../dto/group-membership-response.dto';
import { GroupRole } from '../enums/group-role.enum';
import { GroupSummaryResponseDto } from '../dto/group-summary-response.dto';
import { MembershipSectionRefDto } from '../dto/membership-section-ref.dto';
import { RoleAssignmentResponseDto } from '../dto/role-assignment-response.dto';

export function toGroupResponseDto(group: Group): GroupResponseDto {
  return {
    id: group.id,
    parentGroupId: group.parentGroup ? group.parentGroup.id : null,
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
  myRoles: GroupRole[],
): GroupSummaryResponseDto {
  return {
    id: group.id,
    name: group.name,
    logoUrl: group.logoUrl,
    visibility: group.visibility,
    status: group.status,
    myRoles,
  };
}

export function toGroupMembershipResponseDto(
  membership: GroupMembership,
  rootRoles: GroupRole[],
  sections: MembershipSectionRefDto[],
): GroupMembershipResponseDto {
  return {
    id: membership.id,
    rootGroupId: membership.rootGroup.id,
    user: {
      id: membership.user.id,
      displayName: membership.user.displayName,
    },
    rootRoles,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    leftAt: membership.leftAt ? membership.leftAt.toISOString() : null,
    endReason: membership.endReason,
    sections,
  };
}

export function toMembershipSectionRefDto(
  section: Section,
): MembershipSectionRefDto {
  return {
    id: section.id,
    name: section.name,
  };
}

export function toRoleAssignmentResponseDto(
  roleAssignment: RoleAssignment,
): RoleAssignmentResponseDto {
  return {
    id: roleAssignment.id,
    groupId: roleAssignment.group.id,
    membershipId: roleAssignment.membership.id,
    user: {
      id: roleAssignment.membership.user.id,
      displayName: roleAssignment.membership.user.displayName,
    },
    role: roleAssignment.role,
    grantedAt: roleAssignment.grantedAt.toISOString(),
  };
}
