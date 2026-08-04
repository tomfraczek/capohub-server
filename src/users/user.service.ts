import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  EntityManager,
  EntityRepository,
  LockMode,
} from '@mikro-orm/postgresql';
import type { ClerkClient } from '@clerk/backend';
import { CLERK_CLIENT } from '../auth/clerk/clerk-client.provider';
import { AuthContext } from '../auth/types/auth-context.type';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { EventRolesService } from '../events/event-roles.service';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { ClerkProfile } from './clerk-profile.type';
import { AvatarType } from './enums/avatar-type.enum';
import { User, Theme } from './entities/user.entity';
import { generateDisplayNameFromEmail } from './generate-display-name';

export interface UpdateUserProfileInput {
  displayName?: string;
  theme?: Theme;
  notificationsEnabled?: boolean;
}

@Injectable()
export class UserService {
  constructor(
    private readonly em: EntityManager,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    @Inject(CLERK_CLIENT)
    private readonly clerkClient: ClerkClient,
    private readonly eventRolesService: EventRolesService,
  ) {}

  /**
   * Finds the local User for an authenticated Clerk session, creating it on
   * first login and refreshing email/avatarUrl otherwise. This is the only
   * place a local User is created or synced - there are no webhooks; email
   * changes are impossible in this app, and Clerk is the only place accounts
   * are deleted from outside DELETE /users/me.
   *
   * lastLoginAt is set only when the user is created; it marks the moment of
   * login, not of last activity, so it is never touched on later requests.
   */
  async findOrCreateFromClerk(auth: AuthContext): Promise<User> {
    const profile = await this.fetchClerkProfile(auth.userId);
    const user = await this.userRepository.findOne({
      clerkUserId: auth.userId,
    });

    if (user) {
      this.applyProfileChanges(user, profile);
      await this.em.flush();
      return user;
    }

    const created = this.buildUser(auth.userId, profile);
    created.lastLoginAt = new Date();
    created.publicCode = await generateUniquePublicCode(this.em);
    await this.em.persistAndFlush(created);
    return created;
  }

  /**
   * DELETE /users/me. Ordering is deliberate: the entire local deletion
   * (ownership check + wiping every RoleAssignment/Membership/the User row
   * itself) runs first, as one Postgres transaction, and Clerk is only
   * called once that transaction has committed.
   *
   * This project has no outbox/saga mechanism for external side effects
   * alongside a DB transaction, so a Clerk failure *after* the local
   * transaction commits cannot be rolled back or retried automatically -
   * see deleteLocalAccountData for why this ordering (rather than
   * Clerk-first) is the safer of the two available options, and the
   * residual gap it leaves.
   */
  async deleteAccount(user: User): Promise<void> {
    await this.deleteLocalAccountData(user);
    await this.clerkClient.users.deleteUser(user.clerkUserId);
  }

  /**
   * Wipes every local trace of this User in a single transaction:
   *
   * 1. Re-checks the ownership invariant (every Group/Section must always
   *    have exactly one active OWNER) directly against every currently
   *    active (revokedAt === null) OWNER RoleAssignment this User holds -
   *    Group or Section, queried directly by `user`, no membership
   *    indirection needed at all (see role-assignment.entity.ts). Archived
   *    communities are excluded - an archived Group/Section can never
   *    accept writes again short of unarchiving it first, so its OWNER row
   *    does not block account deletion.
   * 2. If the check passes, deletes every RoleAssignment and every
   *    SectionMembership this User holds, then the User row itself.
   *
   * Deleted explicitly, never left to an FK cascade to discover on its
   * own: both RoleAssignment.user and SectionMembership.user are `cascade`
   * on delete, so this is not strictly required for referential integrity,
   * but keeps the deletion order predictable and explicit rather than
   * implicit, consistent with how this method already treats the
   * ownership check as something that must run - and be lockable - before
   * anything is removed.
   *
   * The User row itself is locked PESSIMISTIC_WRITE first, which
   * additionally blocks a concurrent addMember/grantRole from inserting a
   * *new* row referencing this User mid-deletion (Postgres takes an
   * implicit FOR KEY SHARE lock on the referenced `users` row for every
   * FK-checked insert, which conflicts with FOR UPDATE here).
   */
  private async deleteLocalAccountData(user: User): Promise<void> {
    await this.em.transactional(async (em) => {
      await em.findOneOrFail(
        User,
        { id: user.id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      // Mirrors the ownership check just below, for the same reason: an
      // Event must never be left ownerless (see
      // EVENT_ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX). Only DRAFT/PUBLISHED
      // Events block deletion - CANCELLED/FINISHED are terminal/historical,
      // see EventRolesService.findOwnedActiveEvents.
      const ownedEvents = await this.eventRolesService.findOwnedActiveEvents(
        em,
        user.id,
      );
      if (ownedEvents.length > 0) {
        throw new ConflictException({
          code: 'CANNOT_DELETE_ACCOUNT_OWNS_EVENTS',
          message:
            'This account owns one or more Events - transfer ownership of each before deleting the account',
          ownedEventIds: ownedEvents.map((event) => event.id),
        });
      }

      const ownedAssignments = await em.find(
        RoleAssignment,
        { user: user.id, role: GroupRole.OWNER, revokedAt: null },
        { populate: ['group', 'section'] },
      );
      const ownedActiveCommunities = ownedAssignments
        .map((assignment) => assignment.group ?? assignment.section)
        .filter(
          (community): community is NonNullable<typeof community> =>
            community !== null && community.status !== GroupStatus.ARCHIVED,
        );
      if (ownedActiveCommunities.length > 0) {
        throw new ConflictException({
          code: 'CANNOT_DELETE_ACCOUNT_OWNS_GROUPS',
          message:
            'This account owns one or more Groups/Sections - transfer ownership of each before deleting the account',
          ownedGroupIds: ownedActiveCommunities.map(
            (community) => community.id,
          ),
        });
      }

      await em.nativeDelete(RoleAssignment, { user: user.id });
      await em.nativeDelete(SectionMembership, { user: user.id });
      await em.nativeDelete(User, { id: user.id });
    });
  }

  async updateProfile(
    user: User,
    changes: UpdateUserProfileInput,
  ): Promise<User> {
    if (changes.displayName !== undefined) {
      user.displayName = changes.displayName;
    }
    if (changes.theme !== undefined) {
      user.theme = changes.theme;
    }
    if (changes.notificationsEnabled !== undefined) {
      user.notificationsEnabled = changes.notificationsEnabled;
    }
    await this.em.flush();
    return user;
  }

  // PUT /users/me/avatar/preset. Switches the avatar to a built-in preset
  // identified only by id - the backend does not know or validate the list
  // of valid presets, that lives in the mobile app as static assets.
  async setAvatarPreset(user: User, presetAvatarId: string): Promise<User> {
    user.avatarType = AvatarType.PRESET;
    user.presetAvatarId = presetAvatarId;
    user.avatarUrl = null;
    await this.em.flush();
    return user;
  }

  // PUT /users/me/avatar/clerk. Switches the avatar back to Clerk, fetching
  // the current profile rather than trusting whatever was last synced, since
  // the user's avatar may have changed on Clerk's side while UPLOAD/PRESET
  // was active and applyProfileChanges would not have picked it up.
  async resetAvatarToClerk(user: User): Promise<User> {
    const profile = await this.fetchClerkProfile(user.clerkUserId);
    user.avatarType = AvatarType.CLERK;
    user.avatarUrl = profile.avatarUrl;
    user.presetAvatarId = null;
    await this.em.flush();
    return user;
  }

  private buildUser(clerkUserId: string, profile: ClerkProfile): User {
    const user = new User();
    user.clerkUserId = clerkUserId;
    user.email = profile.email;
    user.avatarType = AvatarType.CLERK;
    user.avatarUrl = profile.avatarUrl;
    user.presetAvatarId = null;
    user.displayName = generateDisplayNameFromEmail(profile.email);
    return user;
  }

  // displayName is deliberately excluded here: it's local/user-owned (see
  // PATCH /users/me), and re-syncing it from Clerk would silently overwrite
  // a user's edit on the very next request. avatarUrl is only synced while
  // avatarType is CLERK - once the user picks UPLOAD or PRESET, this method
  // must not touch avatarUrl/presetAvatarId again (see avatar/preset and
  // avatar/clerk endpoints for the only ways to change avatarType).
  private applyProfileChanges(user: User, profile: ClerkProfile): void {
    if (user.email !== profile.email) {
      user.email = profile.email;
    }
    if (
      user.avatarType === AvatarType.CLERK &&
      user.avatarUrl !== profile.avatarUrl
    ) {
      user.avatarUrl = profile.avatarUrl;
    }
  }

  private async fetchClerkProfile(clerkUserId: string): Promise<ClerkProfile> {
    const clerkUser = await this.clerkClient.users.getUser(clerkUserId);
    const email = clerkUser.primaryEmailAddress?.emailAddress;

    if (!email) {
      throw new Error(`Clerk user ${clerkUserId} has no primary email address`);
    }

    return {
      email: email.trim().toLowerCase(),
      avatarUrl: clerkUser.imageUrl,
    };
  }
}
