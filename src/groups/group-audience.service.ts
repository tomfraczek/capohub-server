import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CustomUserRank } from '../graduation/entities/custom-user-rank.entity';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import { R2StorageService } from '../storage/r2-storage.service';
import { resolveUserAvatarUrl } from '../storage/image-url.util';
import { resolveDisplayName } from '../users/display-name.util';
import { User } from '../users/entities/user.entity';
import { GroupAudienceMemberDto } from './dto/group-audience-member-response.dto';
import { FormalGroupAffiliation } from './entities/formal-group-affiliation.entity';
import { GroupFollow } from './entities/group-follow.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { GroupRole } from './enums/group-role.enum';
import { CommunityListVisibility } from './enums/community-list-visibility.enum';
import { GroupStatus } from './enums/group-status.enum';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { Group } from './entities/group.entity';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupPermissionService } from './permissions/group-permission.service';
import { RoleAssignmentsService } from './role-assignments.service';

const ACTIVE_MEMBERSHIP_STATUSES = [
  SectionMembershipStatus.ACTIVE,
  SectionMembershipStatus.READ_ONLY,
];

type RankRef = NonNullable<GroupAudienceMemberDto['rank']>;

// FULL - OWNER/ADMIN (GROUP_FOLLOWERS_VIEW): every row with its
// memberships, for the admin actions. PUBLIC - a Section member/follower
// of a Group with followersVisibility=PUBLIC: the same people, without
// the membership ids only the admin actions need.
export type GroupAudienceAccess = 'FULL' | 'PUBLIC';

// GET /groups/:id/followers - everyone tied to a Group: active members of
// its *direct* Sections (the same "no inheritance" rule as
// GroupsService.resolveViewerRelation) and its GroupFollow followers,
// deduplicated to one row per user with both flags.
//
// Sorted by the resolved display name (full name, else apelido, else
// publicCode - see resolveDisplayName), in application code over the full
// id set: a Group's audience is small enough for that, and the fallback
// chain has no single SQL column to order by. Only the requested page's ranks are loaded.
@Injectable()
export class GroupAudienceService {
  constructor(
    private readonly em: EntityManager,
    private readonly r2StorageService: R2StorageService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
  ) {}

  /**
   * Who may read GET /groups/:id/followers: OWNER/ADMIN always (any Group
   * status, like getById); otherwise only while the Group is ACTIVE/
   * READ_ONLY with followersVisibility=PUBLIC, and only for someone tied
   * to it - an active member of one of its direct Sections or a follower.
   * Everyone else gets the same 404 as for a Group they can't see at all.
   */
  async resolveAccess(
    groupId: string,
    viewerId: string,
  ): Promise<GroupAudienceAccess> {
    const group = await this.em.findOne(Group, { id: groupId });
    if (!group) {
      throw this.notFound();
    }

    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(groupId, viewerId);
    if (
      authorization &&
      this.groupPermissionService.hasAllPermissionsForRoles(
        'GROUP',
        authorization.roleAssignments.map((assignment) => assignment.role),
        [GroupPermission.GROUP_FOLLOWERS_VIEW],
        null,
      )
    ) {
      return 'FULL';
    }

    const isLive =
      group.status === GroupStatus.ACTIVE ||
      group.status === GroupStatus.READ_ONLY;
    if (
      isLive &&
      group.followersVisibility === CommunityListVisibility.PUBLIC &&
      (await this.isTiedToGroup(groupId, viewerId))
    ) {
      return 'PUBLIC';
    }
    throw this.notFound();
  }

  async list(
    groupId: string,
    page: { limit: number; offset: number },
    access: GroupAudienceAccess = 'FULL',
  ): Promise<{ items: GroupAudienceMemberDto[]; total: number }> {
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager corrupt the underlying pg connection.
    const memberships = await this.em.find(
      SectionMembership,
      {
        section: { parentGroup: groupId },
        status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
      },
      { populate: ['section'] },
    );
    const follows = await this.em.find(
      GroupFollow,
      { group: groupId },
      { fields: ['user'] },
    );
    // At most one active OWNER per Group (ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX).
    const ownerAssignments = await this.em.find(
      RoleAssignment,
      { group: groupId, role: GroupRole.OWNER, revokedAt: null },
      { fields: ['user'] },
    );
    const ownerIds = new Set(ownerAssignments.map((a) => a.user.id));

    const membershipsByUser = new Map<
      string,
      GroupAudienceMemberDto['memberships']
    >();
    for (const membership of memberships) {
      const list = membershipsByUser.get(membership.user.id) ?? [];
      list.push({
        membershipId: membership.id,
        sectionId: membership.section.id,
        sectionName: membership.section.name,
      });
      membershipsByUser.set(membership.user.id, list);
    }
    const memberIds = new Set(membershipsByUser.keys());
    const followerIds = new Set(follows.map((f) => f.user.id));
    const allIds = [...new Set([...memberIds, ...followerIds])];
    if (allIds.length === 0) {
      return { items: [], total: 0 };
    }

    const users = await this.em.find(User, { id: { $in: allIds } });
    const rows = users
      .map((user) => ({ user, displayName: resolveDisplayName(user) }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pl'));
    const pageRows = rows.slice(page.offset, page.offset + page.limit);
    const rankByUserId = await this.loadVisibleRanks(
      pageRows.map((row) => row.user),
    );

    return {
      total: rows.length,
      items: pageRows.map(({ user, displayName }) => ({
        user: {
          id: user.id,
          displayName,
          apelido: user.apelido,
          image: {
            type: user.avatarType,
            url: resolveUserAvatarUrl(user, this.r2StorageService),
            presetAvatarId: user.presetAvatarId,
          },
        },
        rank: rankByUserId.get(user.id) ?? null,
        isOwner: ownerIds.has(user.id),
        isMemberThroughSection: memberIds.has(user.id),
        isFollowing: followerIds.has(user.id),
        memberships:
          access === 'FULL'
            ? (membershipsByUser.get(user.id) ?? []).sort((a, b) =>
                a.sectionName.localeCompare(b.sectionName, 'pl'),
              )
            : [],
      })),
    };
  }

  private async isTiedToGroup(
    groupId: string,
    userId: string,
  ): Promise<boolean> {
    // Sequential, not Promise.all - see list() above.
    const memberships = await this.em.count(SectionMembership, {
      user: userId,
      section: { parentGroup: groupId },
      status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
    });
    if (memberships > 0) {
      return true;
    }
    return (
      (await this.em.count(GroupFollow, { user: userId, group: groupId })) > 0
    );
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  /**
   * Batched mirror of the public profile's effective rank (see
   * UserProfileService.getPublicProfile/resolvePublicFormalRank and the
   * app's computeEffectiveRank): the current FormalRankAssignment counts
   * only while a matching active FormalGroupAffiliation exists and both
   * showFormalGroup and showFormalRank are on; otherwise the independent
   * rank, gated by showFormalRank alone.
   */
  private async loadVisibleRanks(users: User[]): Promise<Map<string, RankRef>> {
    const result = new Map<string, RankRef>();
    const visible = users.filter((user) => user.showFormalRank);
    if (visible.length === 0) {
      return result;
    }

    const formalCandidates = visible
      .filter((user) => user.showFormalGroup)
      .map((user) => user.id);
    if (formalCandidates.length > 0) {
      const affiliations = await this.em.find(
        FormalGroupAffiliation,
        { user: { $in: formalCandidates }, endedOn: null },
        { fields: ['user', 'group'] },
      );
      const affiliationGroupByUser = new Map(
        affiliations.map((a) => [a.user.id, a.group.id]),
      );
      const assignments = await this.em.find(
        FormalRankAssignment,
        { user: { $in: formalCandidates }, endedOn: null },
        { populate: ['rank.cordSegments'] },
      );
      for (const assignment of assignments) {
        if (
          affiliationGroupByUser.get(assignment.user.id) ===
          assignment.sourceGroup.id
        ) {
          result.set(assignment.user.id, {
            name: assignment.rank.name,
            cordSegments: toSegments(assignment.rank.cordSegments.getItems()),
          });
        }
      }
    }

    const independentCandidates = visible
      .map((user) => user.id)
      .filter((id) => !result.has(id));
    if (independentCandidates.length > 0) {
      const customRanks = await this.em.find(
        CustomUserRank,
        { user: { $in: independentCandidates } },
        { populate: ['cordSegments'] },
      );
      for (const customRank of customRanks) {
        result.set(customRank.user.id, {
          name: customRank.name,
          cordSegments: toSegments(customRank.cordSegments.getItems()),
        });
      }
    }

    return result;
  }
}

function toSegments(
  segments: { position: number; colorHex: string; proportion: number }[],
): RankRef['cordSegments'] {
  return [...segments]
    .sort((a, b) => a.position - b.position)
    .map(({ position, colorHex, proportion }) => ({
      position,
      colorHex,
      proportion,
    }));
}
