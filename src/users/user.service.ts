import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import type { ClerkClient } from '@clerk/backend';
import { CLERK_CLIENT } from '../auth/clerk/clerk-client.provider';
import { AuthContext } from '../auth/types/auth-context.type';
import { User } from './entities/user.entity';

interface ClerkProfile {
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

export interface UpdateUserProfileInput {
  firstName?: string | null;
  lastName?: string | null;
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
   * first sight and refreshing profile fields + lastLoginAt otherwise.
   * There are no webhooks yet, so this runs on every authenticated request.
   */
  async findOrCreateFromClerk(auth: AuthContext): Promise<User> {
    const profile = await this.fetchClerkProfile(auth.userId);
    const user = await this.userRepository.findOne({
      clerkUserId: auth.userId,
    });

    if (user) {
      this.applyProfileChanges(user, profile);
      user.lastLoginAt = new Date();
      await this.em.flush();
      return user;
    }

    const created = new User();
    created.clerkUserId = auth.userId;
    created.email = profile.email;
    created.firstName = profile.firstName;
    created.lastName = profile.lastName;
    created.imageUrl = profile.imageUrl;
    created.lastLoginAt = new Date();
    await this.em.persistAndFlush(created);
    return created;
  }

  async updateProfile(
    user: User,
    changes: UpdateUserProfileInput,
  ): Promise<User> {
    if (changes.firstName !== undefined) {
      user.firstName = changes.firstName;
    }
    if (changes.lastName !== undefined) {
      user.lastName = changes.lastName;
    }
    await this.em.flush();
    return user;
  }

  // firstName/lastName are deliberately excluded here: PATCH /users/me lets
  // the user own those locally, and re-syncing them from Clerk on every
  // request would silently overwrite that edit on the very next request.
  // Clerk stays authoritative for email/imageUrl, which aren't user-editable.
  private applyProfileChanges(user: User, profile: ClerkProfile): void {
    if (user.email !== profile.email) {
      user.email = profile.email;
    }
    if (user.imageUrl !== profile.imageUrl) {
      user.imageUrl = profile.imageUrl;
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
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      imageUrl: clerkUser.imageUrl,
    };
  }
}
