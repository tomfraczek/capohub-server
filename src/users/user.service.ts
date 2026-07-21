import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityManager, EntityRepository, LockMode } from '@mikro-orm/postgresql';
import type { ClerkClient } from '@clerk/backend';
import { CLERK_CLIENT } from '../auth/clerk/clerk-client.provider';
import { AuthContext } from '../auth/types/auth-context.type';
import { GroupMembership } from '../groups/entities/group-membership.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
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
    private readonly roleAssignmentsService: RoleAssignmentsService,
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
   * 1. Re-checks the Group-ownership invariant (every Group must always
   *    have exactly one OWNER - see ADR-028) against every Membership this
   *    User ever held, active or archived - not just ACTIVE ones, since an
   *    OWNER RoleAssignment row can in principle outlive its Membership's
   *    ACTIVE status and must still block deletion.
   * 2. If the check passes, deletes every RoleAssignment belonging to any
   *    of those Memberships, then the Memberships themselves, then the
   *    User row.
   *
   * RoleAssignments are deleted explicitly, never left to an FK cascade -
   * RoleAssignment.membership has no delete rule at all (see the
   * RoleAssignment entity), so relying on GroupMembership.user's cascade to
   * reach it would surface as a raw Postgres FK violation (500) instead of
   * either succeeding cleanly or failing with a domain error. Memberships
   * are hard-deleted, not archived: GroupMembership.user is a required,
   * cascade-delete relation (unlike the optional, set-null User references
   * on Song/SongMedia - see Scenario 16), so a Membership cannot survive
   * without its User, only disappear alongside it.
   *
   * Every Membership row is locked PESSIMISTIC_WRITE before the ownership
   * re-check, so a concurrent transferOwnership naming one of them the new
   * owner of some Group is serialized against this transaction - whichever
   * commits first is the state the other observes. The User row itself is
   * also locked PESSIMISTIC_WRITE first, which additionally blocks a
   * concurrent addMember from inserting a *new* Membership for this User
   * mid-deletion (Postgres takes an implicit FOR KEY SHARE lock on the
   * referenced `users` row for every FK-checked insert into
   * group_memberships, which conflicts with FOR UPDATE here).
   *
   * This does not close every conceivable race: a grantRole call granting
   * some non-OWNER Role (MEMBER/ADMIN/INSTRUCTOR/ASSISTANT) to one of
   * these Memberships in the exact same instant this transaction is
   * deleting it is not itself locked against here, since grantRole does
   * not take a lock on the Membership row. In that narrow window, the
   * grantRole request can surface its own raw FK error rather than a clean
   * response - a pre-existing gap in grantRole, not something this method
   * can fix without changing that code path, and not a violation of the
   * OWNER invariant (grantRole can never grant OWNER - see
   * RoleAssignmentsService.grantRole), so no Group is ever left ownerless
   * because of it.
   */
  private async deleteLocalAccountData(user: User): Promise<void> {
    await this.em.transactional(async (em) => {
      await em.findOneOrFail(
        User,
        { id: user.id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      const memberships = await em.find(
        GroupMembership,
        { user: user.id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      for (const membership of memberships) {
        const ownedGroups = await this.roleAssignmentsService.findOwnedActiveGroups(
          em,
          membership.id,
          membership.rootGroup.id,
        );
        if (ownedGroups.length > 0) {
          throw new ConflictException({
            code: 'CANNOT_DELETE_ACCOUNT_OWNS_GROUPS',
            message:
              'This account owns one or more Groups - transfer ownership of each before deleting the account',
            ownedGroupIds: ownedGroups.map((group) => group.id),
          });
        }
      }

      if (memberships.length > 0) {
        const membershipIds = memberships.map((membership) => membership.id);
        await em.nativeDelete(RoleAssignment, {
          membership: { $in: membershipIds },
        });
        await em.nativeDelete(GroupMembership, { id: { $in: membershipIds } });
      }

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
