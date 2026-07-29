import { GroupMembership } from '../entities/group-membership.entity';
import { Group } from '../entities/group.entity';
import { RoleAssignment } from '../entities/role-assignment.entity';
import { Cohort } from '../entities/cohort.entity';
import { GroupResponseDto } from '../dto/group-response.dto';
import { GroupMembershipResponseDto } from '../dto/group-membership-response.dto';
import { GroupRole } from '../enums/group-role.enum';
import { GroupSummaryResponseDto } from '../dto/group-summary-response.dto';
import { MembershipCohortRefDto } from '../dto/membership-cohort-ref.dto';
import { RoleAssignmentResponseDto } from '../dto/role-assignment-response.dto';

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
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    memberInvitesAllowed: group.memberInvitesAllowed,
    publicCode: group.publicCode,
    status: group.status,
    timezone: group.timezone,
    currencyCode: group.currencyCode,
    country: group.country,
    city: group.city,
    region: group.region,
    geonameId: group.geonameId,
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
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    publicCode: group.publicCode,
    status: group.status,
    myRoles,
  };
}

export function toGroupMembershipResponseDto(
  membership: GroupMembership,
  rootRoles: GroupRole[],
  cohorts: MembershipCohortRefDto[],
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
    cohorts,
  };
}

export function toMembershipCohortRefDto(
  cohort: Cohort,
): MembershipCohortRefDto {
  return {
    id: cohort.id,
    name: cohort.name,
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
