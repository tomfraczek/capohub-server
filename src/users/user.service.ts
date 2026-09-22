import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  EntityManager,
  EntityRepository,
  LockMode,
} from '@mikro-orm/postgresql';
import type { ClerkClient } from '@clerk/backend';
import { CLERK_CLIENT } from '../auth/clerk/clerk-client.provider';
import { AuthContext } from '../auth/types/auth-context.type';
import { assignUniqueNumericCode } from '../common/utils/numeric-code';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { EventRoleAssignment } from '../events/entities/event-role-assignment.entity';
import { EventRolesService } from '../events/event-roles.service';
import { EventsService } from '../events/events.service';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { ImageAssetService } from '../storage/image-asset.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import { buildUserProfileImageKey } from '../storage/object-keys.util';
import { ClerkProfile, ExternalAccountProvider } from './clerk-profile.type';
import { AvatarType } from './enums/avatar-type.enum';
import { GooglePeopleApiService } from './google-people-api.service';
import {
  User,
  Theme,
  USERS_NUMERIC_CODE_UNIQUE_INDEX,
} from './entities/user.entity';
import { generateDisplayNameFromEmail } from './generate-display-name';

export interface UpdateUserProfileInput {
  displayName?: string;
  theme?: Theme;
  notificationsEnabled?: boolean;
  timezone?: string;
  currencyCode?: string;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly em: EntityManager,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    @Inject(CLERK_CLIENT)
    private readonly clerkClient: ClerkClient,
    private readonly eventRolesService: EventRolesService,
    private readonly eventsService: EventsService,
    private readonly imageProcessingService: ImageProcessingService,
    private readonly imageAssetService: ImageAssetService,
    private readonly googlePeopleApiService: GooglePeopleApiService,
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
    // Account creation is one of the few moments this app calls out to the
    // Google People API - see syncGoogleHasCustomPhoto's own comment for
    // why this never runs on the (existing-user) branch above.
    await this.syncGoogleHasCustomPhoto(
      created,
      auth.userId,
      profile.externalAccountProvider,
    );
    await assignUniqueNumericCode(
      this.em,
      async (trx, code) => {
        created.numericCode = code;
        await trx.persistAndFlush(created);
      },
      USERS_NUMERIC_CODE_UNIQUE_INDEX,
    );
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
   *    does not block account deletion. The identical rule applies to a
   *    live Event this User owns via EventRole.OWNER (see
   *    EventRolesService.findOwnedActiveEvents) - that gate is separate
   *    from, and unaffected by, this User's public organizer identity (see
   *    step 2 below).
   * 2. Force-closes every Event where this User is the public organizer
   *    identity (Event.organizerUser), regardless of EventRole - see
   *    EventsService.closeOrganizedEventsForAccountDeletion. Unlike
   *    EventRole.OWNER above, organizerUser has no transfer mechanism, so
   *    it is never a hard block on its own: a live Event is force-cancelled
   *    then archived, a terminal one is simply archived, and organizerUser
   *    itself is cleared automatically (ON DELETE SET NULL - see
   *    event.entity.ts) the moment the User row is deleted in step 4. The
   *    Event's organizer identity survives via its
   *    organizerType/organizerUserDisplayName snapshot regardless.
   * 3. If the ownership check passes, deletes every EventRoleAssignment,
   *    every (Group/Section) RoleAssignment and every SectionMembership
   *    this User holds, then the User row itself. EventRoleAssignment.user
   *    is, unlike the other two, a non-nullable `deleteRule: 'no action'`
   *    FK (see event-role-assignment.entity.ts) - it must be deleted
   *    explicitly here or the final User delete would fail outright with a
   *    raw FK violation for anyone who has ever held an Event role
   *    (including OWNER on an Event step 2 just archived).
   *
   * RoleAssignment.user and SectionMembership.user are `cascade` on
   * delete, so deleting them explicitly is not strictly required for
   * referential integrity, but keeps the deletion order predictable and
   * explicit rather than implicit, consistent with how this method already
   * treats the ownership check as something that must run - and be
   * lockable - before anything is removed.
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

      // Runs before the User row is removed below - a still-live Event
      // needs its own organizer's account to still exist while it is being
      // cancelled/archived (recordHistory.actor references it) - see that
      // method's own comment for the full DRAFT/PUBLISHED/FINISHED/
      // CANCELLED/ARCHIVED breakdown.
      await this.eventsService.closeOrganizedEventsForAccountDeletion(
        em,
        user.id,
        user,
      );

      // EventRoleAssignment.user is a non-nullable, `deleteRule: 'no
      // action'` FK (see event-role-assignment.entity.ts) - unlike
      // RoleAssignment/SectionMembership below, nothing about it is
      // status-aware, so it must be cleared explicitly here or the
      // `nativeDelete(User, ...)` below would fail with a raw FK violation
      // for anyone who has ever held an Event role, including OWNER on the
      // Event(s) closeOrganizedEventsForAccountDeletion just finished
      // closing out above. Safe unconditionally at this point: the
      // OWNER-of-a-still-active-Event case already threw
      // CANNOT_DELETE_ACCOUNT_OWNS_EVENTS earlier in this same method
      // (before anything was deleted) if it applied, so every remaining
      // EventRoleAssignment row for this user is either a non-OWNER role,
      // or an OWNER role on an Event that is now terminal
      // (FINISHED/CANCELLED/ARCHIVED) - both are fine to drop, the same
      // way an ARCHIVED Group/Section's own OWNER row is (see the
      // Group/Section ownership check above).
      await em.nativeDelete(EventRoleAssignment, { user: user.id });

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
    if (changes.timezone !== undefined) {
      user.timezone = changes.timezone;
    }
    if (changes.currencyCode !== undefined) {
      user.currencyCode = changes.currencyCode;
    }
    await this.em.flush();
    return user;
  }

  // PUT /users/me/avatar/preset. Switches the avatar to a built-in preset
  // identified only by id - the backend does not know or validate the list
  // of valid presets, that lives in the mobile app as static assets.
  //
  // Module: "R2: upload/replace/delete zdjęć" §24 - if the avatar being
  // replaced was an R2 upload, that object must not linger in the bucket
  // just because the user switched to a preset. Order: remember the old
  // key, persist the preset change unconditionally (this is a real state
  // change either way, unlike DELETE - see ImageAssetService.remove's own
  // comment on why that one is conditionally idempotent and this is not),
  // then best-effort delete the old R2 object - a delete failure here is
  // logged, never thrown (the avatar switch itself already succeeded).
  async setAvatarPreset(user: User, presetAvatarId: string): Promise<User> {
    const previousUploadKey = user.avatarImageKey;
    user.avatarType = AvatarType.PRESET;
    user.presetAvatarId = presetAvatarId;
    user.avatarUrl = null;
    user.avatarImageKey = null;
    await this.em.flush();
    await this.imageAssetService.cleanupOrphan(
      previousUploadKey,
      { resourceType: 'user-avatar', resourceId: user.id },
      'avatar switched to a preset',
    );
    return user;
  }

  // PUT /users/me/avatar/clerk. Switches the avatar back to Clerk, fetching
  // the current profile rather than trusting whatever was last synced, since
  // the user's avatar may have changed on Clerk's side while UPLOAD/PRESET
  // was active and applyProfileChanges would not have picked it up.
  //
  // Same R2 cleanup as setAvatarPreset above (module spec §25) - if the
  // avatar being replaced was an R2 upload, delete it after the DB switch
  // commits.
  async resetAvatarToClerk(user: User): Promise<User> {
    const profile = await this.fetchClerkProfile(user.clerkUserId);
    const previousUploadKey = user.avatarImageKey;
    user.avatarType = AvatarType.CLERK;
    user.avatarUrl = profile.avatarUrl;
    user.clerkHasImage = profile.clerkHasImage;
    user.presetAvatarId = null;
    user.avatarImageKey = null;
    // Explicitly re-establishing the Clerk avatar is exactly the kind of
    // rare, meaningful moment syncGoogleHasCustomPhoto is meant for - see
    // its own comment.
    await this.syncGoogleHasCustomPhoto(
      user,
      user.clerkUserId,
      profile.externalAccountProvider,
    );
    await this.em.flush();
    await this.imageAssetService.cleanupOrphan(
      previousUploadKey,
      { resourceType: 'user-avatar', resourceId: user.id },
      'avatar reset to Clerk',
    );
    return user;
  }

  // PUT /users/me/profile-image (module spec §16/§26) - uploads (or
  // replaces) this User's own avatar as an R2-hosted image. Always sets
  // avatarType to UPLOAD and clears presetAvatarId (module spec §23) -
  // mirrors setAvatarPreset/resetAvatarToClerk's own "the three avatar
  // fields always change together" invariant (see avatarType's own comment
  // on user.entity.ts). avatarUrl is cleared alongside avatarImageKey so
  // the two legacy/R2 fields never disagree about which is authoritative
  // (see user.entity.ts's avatarUrl comment) - the response's avatarUrl is
  // always resolved from avatarImageKey once this returns (see
  // resolveUserAvatarUrl).
  async uploadAvatar(user: User, file: Express.Multer.File): Promise<User> {
    const processed = await this.imageProcessingService.processProfileImage(
      file.buffer,
    );
    const newKey = buildUserProfileImageKey(user.id);
    await this.imageAssetService.replace({
      processedBuffer: processed,
      newKey,
      oldKey: user.avatarImageKey,
      persist: async (key) => {
        user.avatarType = AvatarType.UPLOAD;
        user.avatarImageKey = key;
        user.avatarUrl = null;
        user.presetAvatarId = null;
        await this.em.flush();
      },
      logContext: { resourceType: 'user-avatar', resourceId: user.id },
    });
    return user;
  }

  // DELETE /users/me/profile-image (module spec §26). Only meaningful for
  // an UPLOAD avatar - PRESET/CLERK have no R2 object to remove, and
  // deleting "the current image" for either of those is answered by their
  // own dedicated endpoints (avatar/preset, avatar/clerk), not this one, so
  // this is a plain no-op for them (idempotent success, same as an UPLOAD
  // avatar being deleted twice in a row - module spec §42).
  //
  // Falls back to CLERK when the account has a usable Clerk avatar URL,
  // otherwise falls back to PRESET with no presetAvatarId (module spec: "a
  // neutral fallback consistent with the current architecture" - there is
  // no third avatarType to invent, and PRESET with a null id is already a
  // valid, renderable state the frontend must already handle for a
  // brand-new account that has never picked a preset).
  async deleteAvatar(user: User): Promise<User> {
    if (user.avatarType !== AvatarType.UPLOAD) {
      return user;
    }
    const oldKey = user.avatarImageKey;
    await this.imageAssetService.remove({
      oldKey,
      persist: async () => {
        const profile = await this.fetchClerkProfile(user.clerkUserId);
        if (profile.avatarUrl) {
          user.avatarType = AvatarType.CLERK;
          user.avatarUrl = profile.avatarUrl;
          user.clerkHasImage = profile.clerkHasImage;
          user.presetAvatarId = null;
          // Falling back to the Clerk avatar is another explicit,
          // avatar-touching moment - same reasoning as resetAvatarToClerk.
          await this.syncGoogleHasCustomPhoto(
            user,
            user.clerkUserId,
            profile.externalAccountProvider,
          );
        } else {
          user.avatarType = AvatarType.PRESET;
          user.avatarUrl = null;
          user.presetAvatarId = null;
        }
        user.avatarImageKey = null;
        await this.em.flush();
      },
      logContext: { resourceType: 'user-avatar', resourceId: user.id },
    });
    return user;
  }

  private buildUser(clerkUserId: string, profile: ClerkProfile): User {
    const user = new User();
    user.clerkUserId = clerkUserId;
    user.email = profile.email;
    user.avatarType = AvatarType.CLERK;
    user.avatarUrl = profile.avatarUrl;
    user.clerkHasImage = profile.clerkHasImage;
    user.presetAvatarId = null;
    user.displayName = generateDisplayNameFromEmail(profile.email);
    return user;
  }

  // displayName is deliberately excluded here: it's local/user-owned (see
  // PATCH /users/me), and re-syncing it from Clerk would silently overwrite
  // a user's edit on the very next request. avatarUrl/clerkHasImage are only
  // synced while avatarType is CLERK - once the user picks UPLOAD or PRESET,
  // this method must not touch them again (see avatar/preset and
  // avatar/clerk endpoints for the only ways to change avatarType).
  private applyProfileChanges(user: User, profile: ClerkProfile): void {
    if (user.email !== profile.email) {
      user.email = profile.email;
    }
    if (user.avatarType === AvatarType.CLERK) {
      if (user.avatarUrl !== profile.avatarUrl) {
        user.avatarUrl = profile.avatarUrl;
      }
      if (user.clerkHasImage !== profile.clerkHasImage) {
        user.clerkHasImage = profile.clerkHasImage;
      }
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
      // The real Clerk SDK always provides hasImage (non-optional on its
      // User type), so this `?? null` never actually triggers in
      // production - it exists purely so the dozens of e2e test doubles
      // across this repo that stub getUser() with a bare { imageUrl,
      // primaryEmailAddress } and predate this field degrade to "unknown"
      // (conservative - never counted as a real photo) instead of crashing
      // or silently becoming `undefined`. Never coerced to true here - see
      // ClerkProfile's own comment on why a guessed positive is wrong.
      clerkHasImage: clerkUser.hasImage ?? null,
      externalAccountProvider: resolveExternalAccountProvider(
        clerkUser.externalAccounts,
      ),
    };
  }

  // Only ever called from the few explicit avatar-touching moments listed
  // on User.googleHasCustomPhoto's own comment (account creation, PUT
  // /users/me/avatar/clerk, DELETE /users/me/profile-image's Clerk-fallback
  // branch) - never from applyProfileChanges, which runs on every
  // authenticated request (via ClerkAuthGuard -> findOrCreateFromClerk).
  // That split is the whole point: it keeps the one external call this
  // method makes (getUserOauthAccessToken, then GooglePeopleApiService's
  // own HTTP call) off the hot GET /users/me path entirely, while still
  // keeping the signal fresh at the moments it can actually change from the
  // user's perspective (a new account, or the user explicitly re-pointing
  // their avatar at Clerk/Google).
  //
  // Non-Google accounts (and accounts with no external account at all,
  // e.g. email/password) never reach the Clerk/Google calls below - the
  // People API is provider-specific and has nothing to say about them, so
  // they get the same safe `null` ("not applicable") as a Google account
  // that hasn't been checked yet.
  private async syncGoogleHasCustomPhoto(
    user: User,
    clerkUserId: string,
    provider: ExternalAccountProvider | null,
  ): Promise<void> {
    if (provider !== 'google') {
      user.googleHasCustomPhoto = null;
      return;
    }

    try {
      const tokenResponse = await this.clerkClient.users.getUserOauthAccessToken(
        clerkUserId,
        'google',
      );
      const accessToken = tokenResponse.data[0]?.token;

      user.googleHasCustomPhoto = accessToken
        ? await this.googlePeopleApiService.resolveHasCustomPhoto(accessToken)
        : null;
    } catch (err) {
      // Clerk's own OAuth-token endpoint failing (revoked grant, Clerk
      // outage, ...) must never crash the avatar action that triggered
      // this - same conservative "unknown" fallback as a failed People API
      // call itself (see GooglePeopleApiService).
      this.logger.warn(
        `Failed to fetch a Google OAuth access token for ${clerkUserId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      user.googleHasCustomPhoto = null;
    }
  }
}

// Clerk's ExternalAccount.provider is documented as e.g. "google" but is
// actually returned with an "oauth_" prefix in practice (verified against
// the real API) - normalized here once so every caller compares against
// the same plain provider ids. The first external account is treated as
// authoritative; this app never links more than one to a User today.
function resolveExternalAccountProvider(
  externalAccounts: { provider: string }[] | undefined,
): ExternalAccountProvider | null {
  const primary = externalAccounts?.[0];

  if (!primary) {
    return null;
  }

  return primary.provider.replace(/^oauth_/, '') === 'google'
    ? 'google'
    : 'other';
}
