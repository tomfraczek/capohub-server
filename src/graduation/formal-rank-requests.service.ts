import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { NotificationCategory } from '../notifications/enums/notification-category.enum';
import { NotificationTargetType } from '../notifications/enums/notification-target-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  formalRankRequestApprovedText,
  formalRankRequestReceivedText,
  formalRankRequestRejectedText,
} from '../notifications/notification-text.util';
import {
  CreateNotificationParams,
  NotificationsService,
} from '../notifications/notifications.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { resolveUserAvatarUrl } from '../storage/image-url.util';
import { resolveDisplayName } from '../users/display-name.util';
import { User } from '../users/entities/user.entity';
import {
  GroupFormalRankRequestResponseDto,
  OwnFormalRankRequestStateDto,
} from './dto/formal-rank-request-response.dto';
import { CustomUserRank } from './entities/custom-user-rank.entity';
import { FormalRankAssignment } from './entities/formal-rank-assignment.entity';
import { FormalRankRequest } from './entities/formal-rank-request.entity';
import { Rank } from './entities/rank.entity';
import { FormalRankRequestStatus } from './enums/formal-rank-request-status.enum';
import {
  toDateOnly,
  toFormalRankRequestRankDto,
  toOwnFormalRankRequestResponseDto,
  toSortedSegments,
} from './mappers/formal-rank-request.mapper';
import { resolveRankName } from './rank-name.util';
import { assignFormalRank } from './rank-transitions';

const REQUEST_POPULATE = [
  'user',
  'group',
  'rank.cordSegments',
  'event',
] as const;

// "Prośby o potwierdzenie stopnia" - the review side of FormalRankRequest
// (see that entity). Reviewers are the target Group's OWNER/ADMIN
// (FORMAL_RANK_REQUEST_REVIEW, enforced by the route guard on
// groups/:groupId); every method here additionally requires the request to
// belong to exactly that :groupId, so a reviewer of one Group can never
// reach another Group's requests through their own route.
@Injectable()
export class FormalRankRequestsService {
  constructor(
    private readonly em: EntityManager,
    private readonly r2StorageService: R2StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly groupPermissionService: GroupPermissionService,
  ) {}

  /**
   * FORMAL_RANK_REQUEST_RECEIVED for everyone who may decide `request` -
   * resolved from FORMAL_RANK_REQUEST_REVIEW on its Group (through
   * GroupPermissionService, never by naming roles here), minus the
   * requester themselves. Called by FormalRankService.setCurrent inside the
   * same transaction that created the request.
   */
  async notifyReviewers(
    em: EntityManager,
    request: FormalRankRequest,
  ): Promise<void> {
    const assignments = await em.find(RoleAssignment, {
      group: request.group.id,
      revokedAt: null,
    });
    const rolesByUser = new Map<string, GroupRole[]>();
    for (const assignment of assignments) {
      const roles = rolesByUser.get(assignment.user.id) ?? [];
      roles.push(assignment.role);
      rolesByUser.set(assignment.user.id, roles);
    }
    const reviewerIds = [...rolesByUser.entries()]
      .filter(
        ([userId, roles]) =>
          userId !== request.user.id &&
          this.groupPermissionService.hasAllPermissionsForRoles(
            'GROUP',
            roles,
            [GroupPermission.FORMAL_RANK_REQUEST_REVIEW],
            null,
          ),
      )
      .map(([userId]) => userId);
    if (reviewerIds.length === 0) {
      return;
    }
    const text = formalRankRequestReceivedText(
      resolveDisplayName(request.user),
      resolveRankName(request.rank, request.user.gender),
    );
    await this.notificationsService.createMany(
      em,
      reviewerIds.map((userId) =>
        this.buildNotificationParams(
          request,
          em.getReference(User, userId),
          NotificationType.FORMAL_RANK_REQUEST_RECEIVED,
          text,
          request.user,
        ),
      ),
    );
  }

  /**
   * The requester withdraws their own PENDING request: CANCELLED (kept as
   * history), nothing else changes - the current rank stays, and a new
   * rank can be chosen later.
   */
  async withdrawOwn(user: User): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(
        FormalRankRequest,
        { user: user.id, status: FormalRankRequestStatus.PENDING },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!request) {
        throw this.notFound();
      }
      request.status = FormalRankRequestStatus.CANCELLED;
      request.decidedAt = new Date();
      await em.flush();
    });
  }

  async getOwnPending(userId: string): Promise<OwnFormalRankRequestStateDto> {
    const request = await this.em.findOne(
      FormalRankRequest,
      { user: userId, status: FormalRankRequestStatus.PENDING },
      { populate: REQUEST_POPULATE },
    );
    return {
      request: request ? toOwnFormalRankRequestResponseDto(request) : null,
    };
  }

  async listPendingForGroup(
    groupId: string,
  ): Promise<GroupFormalRankRequestResponseDto[]> {
    const requests = await this.em.find(
      FormalRankRequest,
      { group: groupId, status: FormalRankRequestStatus.PENDING },
      { populate: REQUEST_POPULATE, orderBy: { createdAt: 'asc' } },
    );
    const currentRanks = await this.loadCurrentRanks(
      requests.map((request) => request.user),
    );

    return requests.map((request) => ({
      id: request.id,
      user: {
        id: request.user.id,
        displayName: resolveDisplayName(request.user),
        apelido: request.user.apelido,
        image: {
          type: request.user.avatarType,
          url: resolveUserAvatarUrl(request.user, this.r2StorageService),
          presetAvatarId: request.user.presetAvatarId,
        },
        gender: request.user.gender,
      },
      currentRank: currentRanks.get(request.user.id) ?? null,
      requestedRank: toFormalRankRequestRankDto(
        request.rank,
        request.user.gender,
      ),
      startedOn: toDateOnly(request.startedOn),
      awardedByName: request.awardedByName,
      createdAt: request.createdAt.toISOString(),
    }));
  }

  /**
   * The requested rank becomes the user's current one with exactly the
   * declared startedOn/awardedByName/event; the previous current rank
   * (formal or independent) is ended, never deleted (assignFormalRank).
   * `rankId` lets the reviewer confirm a different, correct rank of this
   * same Group's catalog instead (the user picked the wrong one) - kept as
   * approvedRank, while `rank` still records what was asked.
   * Refused when it no longer makes sense: the user's formal Group is no
   * longer this one (FORMAL_RANK_REQUEST_GROUP_CHANGED - normally already
   * CANCELLED by the switch itself), or the Rank was archived meanwhile.
   */
  async approve(
    groupId: string,
    requestId: string,
    actor: User,
    rankId: string | null = null,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await this.loadPendingForGroup(em, groupId, requestId);

      const stillFormalGroup =
        (await em.count(FormalGroupAffiliation, {
          user: request.user.id,
          group: groupId,
          endedOn: null,
        })) > 0;
      if (!stillFormalGroup) {
        throw new ConflictException({
          code: 'FORMAL_RANK_REQUEST_GROUP_CHANGED',
          message: "This group is no longer the user's formal group",
        });
      }
      const confirmedRank =
        rankId && rankId !== request.rank.id
          ? await this.loadCatalogRank(em, groupId, rankId)
          : request.rank;
      if (confirmedRank.isArchived) {
        throw new ConflictException({
          code: 'RANK_ARCHIVED',
          message: 'This rank has been archived in the meantime',
        });
      }

      await assignFormalRank(em, {
        user: request.user,
        rank: confirmedRank,
        group: request.group,
        startedOn: request.startedOn,
        awardedByName: request.awardedByName,
        event: request.event,
      });
      const corrected = confirmedRank.id !== request.rank.id;
      request.status = FormalRankRequestStatus.APPROVED;
      request.approvedRank = corrected ? confirmedRank : null;
      request.decidedAt = new Date();
      request.decidedBy = actor;
      await em.flush();

      await this.notificationsService.createMany(em, [
        this.buildNotificationParams(
          request,
          request.user,
          NotificationType.FORMAL_RANK_REQUEST_APPROVED,
          formalRankRequestApprovedText(
            resolveRankName(confirmedRank, request.user.gender),
            request.group.name,
            resolveDisplayName(actor),
            corrected
              ? resolveRankName(request.rank, request.user.gender)
              : null,
          ),
          actor,
        ),
      ]);
    });
  }

  /** Nothing else changes; the user may send a new request later. */
  async reject(
    groupId: string,
    requestId: string,
    actor: User,
    reason: string | null = null,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await this.loadPendingForGroup(em, groupId, requestId);
      request.status = FormalRankRequestStatus.REJECTED;
      request.rejectionReason = reason;
      request.decidedAt = new Date();
      request.decidedBy = actor;
      await em.flush();

      await this.notificationsService.createMany(em, [
        this.buildNotificationParams(
          request,
          request.user,
          NotificationType.FORMAL_RANK_REQUEST_REJECTED,
          formalRankRequestRejectedText(
            resolveRankName(request.rank, request.user.gender),
            request.group.name,
            resolveDisplayName(actor),
            reason,
          ),
          actor,
        ),
      ]);
    });
  }

  // contextGroup = the Group whose system the rank is from: a reviewer's
  // tap opens its Moderacja list, the requester's opens their own rank.
  private buildNotificationParams(
    request: FormalRankRequest,
    recipient: User,
    type: NotificationType,
    text: { title: string; body: string },
    actor: User,
  ): CreateNotificationParams {
    return {
      recipient,
      category: NotificationCategory.GRADUATION,
      type,
      title: text.title,
      body: text.body,
      targetType: NotificationTargetType.FORMAL_RANK_REQUEST,
      targetId: request.id,
      contextGroup: request.group,
      contextSection: null,
      actor,
    };
  }

  private async loadPendingForGroup(
    em: EntityManager,
    groupId: string,
    requestId: string,
  ): Promise<FormalRankRequest> {
    const request = await em.findOne(
      FormalRankRequest,
      { id: requestId, group: groupId },
      { populate: REQUEST_POPULATE, lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!request) {
      throw this.notFound();
    }
    if (request.status !== FormalRankRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'REQUEST_NOT_PENDING',
        message: `This request is already ${request.status.toLowerCase()}`,
      });
    }
    return request;
  }

  // A rank the reviewer confirms instead of the requested one must come from
  // this same Group's catalog (populated with cords for the assignment).
  private async loadCatalogRank(
    em: EntityManager,
    groupId: string,
    rankId: string,
  ): Promise<Rank> {
    const rank = await em.findOne(
      Rank,
      { id: rankId },
      { populate: ['system.group', 'cordSegments'] },
    );
    if (!rank) {
      throw new NotFoundException({
        code: 'RANK_NOT_FOUND',
        message: 'Rank not found',
      });
    }
    if (rank.system.group.id !== groupId) {
      throw new ConflictException({
        code: 'RANK_NOT_IN_FORMAL_GROUP_CATALOG',
        message: "This rank does not belong to this group's catalog",
      });
    }
    return rank;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'FORMAL_RANK_REQUEST_NOT_FOUND',
      message: 'Rank request not found',
    });
  }

  // Each requester's current rank - at most one of an active
  // FormalRankAssignment / active CustomUserRank exists per user (see
  // rank-transitions.ts); formal wins defensively if both ever do.
  private async loadCurrentRanks(
    users: User[],
  ): Promise<
    Map<string, NonNullable<GroupFormalRankRequestResponseDto['currentRank']>>
  > {
    const result = new Map<
      string,
      NonNullable<GroupFormalRankRequestResponseDto['currentRank']>
    >();
    if (users.length === 0) {
      return result;
    }
    const userIds = users.map((user) => user.id);
    // A formal rank's title follows its holder's gender (rank-name.util.ts).
    const genderByUserId = new Map(users.map((user) => [user.id, user.gender]));
    // Sequential - concurrent queries on one EntityManager race at the
    // driver level (see GroupsService).
    const independent = await this.em.find(
      CustomUserRank,
      { user: { $in: userIds }, endedOn: null },
      { populate: ['cordSegments'] },
    );
    for (const rank of independent) {
      result.set(rank.user.id, {
        name: rank.name,
        cordSegments: toSortedSegments(rank.cordSegments.getItems()),
        source: 'INDEPENDENT',
        sourceGroup: null,
      });
    }
    const formal = await this.em.find(
      FormalRankAssignment,
      { user: { $in: userIds }, endedOn: null },
      { populate: ['rank.cordSegments', 'sourceGroup'] },
    );
    for (const assignment of formal) {
      result.set(assignment.user.id, {
        name: resolveRankName(
          assignment.rank,
          genderByUserId.get(assignment.user.id),
        ),
        cordSegments: toSortedSegments(assignment.rank.cordSegments.getItems()),
        source: 'FORMAL_GROUP',
        sourceGroup: {
          id: assignment.sourceGroup.id,
          name: assignment.sourceGroup.name,
        },
      });
    }
    return result;
  }
}
