import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { GroupFollow } from './entities/group-follow.entity';
import { Group } from './entities/group.entity';
import { User } from '../users/entities/user.entity';

// Owns GroupFollow end-to-end - see that entity's own comment for what
// "following" a Group means (never a membership, never any role/permission).
// Used directly by GroupsController (follow/unfollow, and the
// isFollowing flag on a single Group's own response DTO) and by
// CommunityOverviewService (myGroups/nearbyGroups need every Group a caller
// follows, in bulk) and by EventNotificationsService (a PUBLIC Group Event's
// audience includes the Group's followers - see that service's own
// comment).
@Injectable()
export class GroupFollowService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Idempotent - following an already-followed Group is a success, not a
   * conflict (module: "Akcje muszą być idempotentne lub bezpiecznie
   * obsługiwać powtórzenie requestu"). Relies on the unique (user, group)
   * index as the real race guard, same pattern as
   * AnnouncementsService.markRead - never a SELECT-before-INSERT to avoid
   * the race, just a graceful catch of the resulting unique violation.
   */
  async follow(user: User, group: Group): Promise<void> {
    const existing = await this.em.findOne(GroupFollow, {
      user: user.id,
      group: group.id,
    });
    if (existing) {
      return;
    }

    const follow = new GroupFollow();
    follow.user = user;
    follow.group = group;
    try {
      await this.em.persist(follow).flush();
    } catch (error) {
      const raceRecord = await this.em.findOne(GroupFollow, {
        user: user.id,
        group: group.id,
      });
      if (!raceRecord) {
        throw error;
      }
    }
  }

  /** Idempotent - unfollowing an already-not-followed Group is a no-op. */
  async unfollow(userId: string, groupId: string): Promise<void> {
    const existing = await this.em.findOne(GroupFollow, {
      user: userId,
      group: groupId,
    });
    if (existing) {
      await this.em.removeAndFlush(existing);
    }
  }

  async isFollowing(userId: string, groupId: string): Promise<boolean> {
    const existing = await this.em.findOne(GroupFollow, {
      user: userId,
      group: groupId,
    });
    return existing !== null;
  }

  /** Bulk isFollowing() - one query instead of N, for a Group listing/DTO batch. */
  async findFollowedGroupIds(
    userId: string,
    groupIds: string[],
  ): Promise<Set<string>> {
    if (groupIds.length === 0) {
      return new Set();
    }
    const rows = await this.em.find(
      GroupFollow,
      { user: userId, group: { $in: groupIds } },
      { fields: ['group'] },
    );
    return new Set(rows.map((row) => row.group.id));
  }

  /** Every Group id this User currently follows, in no particular order. */
  async listFollowedGroupIds(userId: string): Promise<string[]> {
    const rows = await this.em.find(
      GroupFollow,
      { user: userId },
      { fields: ['group'] },
    );
    return rows.map((row) => row.group.id);
  }

  /**
   * Every User id currently following `groupId` - used only for a PUBLIC
   * Group Event's notification audience (see EventNotificationsService).
   */
  async listFollowerUserIds(groupId: string): Promise<string[]> {
    const rows = await this.em.find(
      GroupFollow,
      { group: groupId },
      { fields: ['user'] },
    );
    return rows.map((row) => row.user.id);
  }
}
