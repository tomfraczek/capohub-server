import {
  PublicUrlBuilder,
  resolveImageUrl,
} from '../../storage/image-url.util';
import { SectionMembership } from '../entities/section-membership.entity';
import { Group } from '../entities/group.entity';
import { RoleAssignment } from '../entities/role-assignment.entity';
import { Cohort } from '../entities/cohort.entity';
import { GroupResponseDto } from '../dto/group-response.dto';
import { SectionMembershipResponseDto } from '../dto/section-membership-response.dto';
import { GroupRole } from '../enums/group-role.enum';
import { GroupSummaryResponseDto } from '../dto/group-summary-response.dto';
import { MembershipCohortRefDto } from '../dto/membership-cohort-ref.dto';
import {
  RoleAssignmentResponseDto,
  RoleAssignmentUserRefDto,
} from '../dto/role-assignment-response.dto';

export function toGroupResponseDto(
  group: Group,
  counts: { childGroupsCount: number; directSectionsCount: number },
  urlBuilder: PublicUrlBuilder,
): GroupResponseDto {
  return {
    id: group.id,
    parentGroupId: group.parentGroup?.id ?? null,
    name: group.name,
    description: group.description,
    // Prefers the R2 public URL derived from profileImageKey over the
    // legacy logoUrl column once an upload exists - see
    // storage/image-url.util.ts's resolveImageUrl.
    logoUrl: resolveImageUrl(group.profileImageKey, group.logoUrl, urlBuilder),
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
    childGroupsCount: counts.childGroupsCount,
    directSectionsCount: counts.directSectionsCount,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export function toGroupSummaryResponseDto(
  group: Group,
  myRoles: GroupRole[],
  urlBuilder: PublicUrlBuilder,
): GroupSummaryResponseDto {
  return {
    id: group.id,
    name: group.name,
    logoUrl: resolveImageUrl(group.profileImageKey, group.logoUrl, urlBuilder),
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    publicCode: group.publicCode,
    status: group.status,
    myRoles,
  };
}

export function toSectionMembershipResponseDto(
  membership: SectionMembership,
  roles: GroupRole[],
  cohorts: MembershipCohortRefDto[],
): SectionMembershipResponseDto {
  return {
    id: membership.id,
    sectionId: membership.section.id,
    user: {
      id: membership.user.id,
      displayName: membership.user.displayName,
    },
    roles,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    leftAt: membership.leftAt ? membership.leftAt.toISOString() : null,
    endReason: membership.endReason,
    endedBy: membership.endedBy
      ? {
          id: membership.endedBy.id,
          displayName: membership.endedBy.displayName,
        }
      : null,
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

function toRoleAssignmentUserRefDto(
  user: { id: string; displayName: string } | null,
): RoleAssignmentUserRefDto | null {
  return user ? { id: user.id, displayName: user.displayName } : null;
}

export function toRoleAssignmentResponseDto(
  roleAssignment: RoleAssignment,
): RoleAssignmentResponseDto {
  return {
    id: roleAssignment.id,
    // `group`/`section` are the two nullable halves of RoleAssignment's
    // Group-or-Section reference (see role-assignment.entity.ts) - exactly
    // one is ever set.
    groupId: (roleAssignment.group ?? roleAssignment.section)!.id,
    user: {
      id: roleAssignment.user.id,
      displayName: roleAssignment.user.displayName,
    },
    role: roleAssignment.role,
    grantedAt: roleAssignment.grantedAt.toISOString(),
    grantedBy: toRoleAssignmentUserRefDto(roleAssignment.grantedBy),
    revokedAt: roleAssignment.revokedAt
      ? roleAssignment.revokedAt.toISOString()
      : null,
    revokedBy: toRoleAssignmentUserRefDto(roleAssignment.revokedBy),
  };
}
