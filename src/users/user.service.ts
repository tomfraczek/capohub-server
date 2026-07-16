import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import type { ClerkClient } from '@clerk/backend';
import { CLERK_CLIENT } from '../auth/clerk/clerk-client.provider';
import { AuthContext } from '../auth/types/auth-context.type';
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
   * DELETE /users/me: deletes the Clerk account first (source of truth for
   * the account's existence), then all local data owned by the user.
   */
  async deleteAccount(user: User): Promise<void> {
    await this.clerkClient.users.deleteUser(user.clerkUserId);
    await this.deleteUserData(user);
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

  // Deletes everything this user owns. Only the User row exists today;
  // future modules (playlists, notes, learning progress, favorites, ...)
  // should extend this method with their own cascade-delete calls.
  private async deleteUserData(user: User): Promise<void> {
    await this.em.removeAndFlush(user);
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
