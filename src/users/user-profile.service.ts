import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { AppConfigService } from '../config/app.config';
import { normalizeNumericCodeInput } from '../common/utils/numeric-code';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import {
  cancelPendingGroupJoinRequests,
  startOfTodayUtc,
  switchFormalGroup,
} from '../groups/formal-group-switch';
import { MembershipRequestsService } from '../groups/membership-requests.service';
import { assertNotLeavingOwnedGroup } from '../groups/owner-formal-group';
import { findOwnedLiveGroupIds } from '../groups/user-owns-group';
import { GroupRole } from '../groups/enums/group-role.enum';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { CustomUserRankService } from '../graduation/custom-user-rank.service';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import { FormalRankService } from '../graduation/formal-rank.service';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  FormalGroupResponseDto,
  PendingFormalGroupRequestResponseDto,
} from './dto/formal-group-response.dto';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { UpdateUserProfileInput } from './dto/update-user-profile.schema';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UserSearchListResponseDto } from './dto/user-search-result.dto';
import { User } from './entities/user.entity';
import {
  toFormalGroupResponseDto,
  toPublicUserProfileResponseDto,
  toUserProfileResponseDto,
  toUserSearchResultDto,
} from './user-profile.mapper';

const SEARCH_TEXT_MIN_LENGTH = 2;

const ACTIVE_MEMBERSHIP_STATUSES = [
  SectionMembershipStatus.ACTIVE,
  SectionMembershipStatus.READ_ONLY,
];

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Owns the User Profile Stage 1 surface (see the plan): the caller's own
 * profile (GET/PATCH /users/me/profile), another user's filtered public
 * profile (GET /users/:userId/profile), and the single formal Group
 * affiliation (PUT/DELETE /users/me/formal-group). Queries
 * SectionMembership/RoleAssignment/EventAttendee/EventRoleAssignment
 * directly via EntityManager, the same way RoleAssignmentsService already
 * queries SectionMembership directly rather than through
 * SectionMembershipsService - none of those services expose the
 * user-keyed/cross-entity queries this needs.
 */
@Injectable()
export class UserProfileService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly formalRankService: FormalRankService,
    private readonly customUserRankService: CustomUserRankService,
    private readonly r2StorageService: R2StorageService,
    private readonly appConfigService: AppConfigService,
    private readonly membershipRequestsService: MembershipRequestsService,
  ) {}

  async getOwnProfile(user: User): Promise<UserProfileResponseDto> {
    const formalGroup = await this.loadActiveFormalGroup(user.id);
    return toUserProfileResponseDto(
      user,
      formalGroup,
      this.appConfigService.publicWebBaseUrl,
    );
  }

  async updateOwnProfile(
    user: User,
    changes: UpdateUserProfileInput,
  ): Promise<UserProfileResponseDto> {
    if (changes.firstName !== undefined) {
      user.firstName = changes.firstName;
    }
    if (changes.lastName !== undefined) {
      user.lastName = changes.lastName;
    }
    if (changes.apelido !== undefined) {
      user.apelido = changes.apelido;
    }
    if (changes.capoeiraStartedAt !== undefined) {
      user.capoeiraStartedAt = changes.capoeiraStartedAt
        ? parseDateOnly(changes.capoeiraStartedAt)
        : null;
    }
    if (changes.birthDate !== undefined) {
      user.birthDate = changes.birthDate
        ? parseDateOnly(changes.birthDate)
        : null;
    }
    if (changes.phoneNumber !== undefined) {
      user.phoneNumber = changes.phoneNumber;
    }
    if (changes.gender !== undefined) {
      user.gender = changes.gender;
    }
    if (changes.showCapoeiraStartedAt !== undefined) {
      user.showCapoeiraStartedAt = changes.showCapoeiraStartedAt;
    }
    if (changes.showSections !== undefined) {
      user.showSections = changes.showSections;
    }
    if (changes.showFormalGroup !== undefined) {
      user.showFormalGroup = changes.showFormalGroup;
    }
    if (changes.showFormalRank !== undefined) {
      user.showFormalRank = changes.showFormalRank;
    }
    if (changes.showCareerTimeline !== undefined) {
      user.showCareerTimeline = changes.showCareerTimeline;
    }
    if (changes.showEventParticipation !== undefined) {
      user.showEventParticipation = changes.showEventParticipation;
    }
    await this.em.flush();

    return this.getOwnProfile(user);
  }

  /**
   * Basic identity (firstName/lastName/apelido, and the displayName built
   * from them) is always returned as stored - it has no privacy toggle.
   * Every other field is `null` unless the viewer owns the profile or the
   * corresponding privacy toggle is on.
   */
  async getPublicProfile(
    viewer: User,
    targetUserId: string,
  ): Promise<PublicUserProfileResponseDto> {
    const target = await this.em.findOne(User, { id: targetUserId });
    if (!target) {
      throw this.userNotFound();
    }

    const isOwner = viewer.id === target.id;

    // Sequential, not concurrent - concurrent queries on the same
    // EntityManager corrupt the underlying pg connection (see
    // SectionMembershipsService for the same constraint).
    const canSeeCapoeiraStartedAt = isOwner || target.showCapoeiraStartedAt;
    const canSeeSections = isOwner || target.showSections;
    const canSeeFormalGroup = isOwner || target.showFormalGroup;
    // Reused for `independentRank` too, not just `formalRank` - see this
    // method's assembly below and the field's own doc comment in
    // public-user-profile-response.dto.ts. There is deliberately no
    // separate "show independent rank" column: both fields represent "the
    // rank shown on my profile", so a single toggle covers both.
    const canSeeFormalRank = isOwner || target.showFormalRank;

    const sections = canSeeSections
      ? await this.loadActiveSections(target.id)
      : null;
    const sectionRoles = sections
      ? await this.loadSectionRoles(
          target.id,
          sections.map((section) => section.id),
        )
      : new Map<string, GroupRole[]>();
    const formalGroup = canSeeFormalGroup
      ? await this.loadActiveFormalGroup(target.id)
      : null;
    const formalRank = canSeeFormalRank
      ? await this.resolvePublicFormalRank(target.id)
      : null;
    const independentRank = canSeeFormalRank
      ? await this.customUserRankService.getCurrentOrNull(target.id)
      : null;

    return toPublicUserProfileResponseDto(target, {
      canSeeCapoeiraStartedAt,
      sections,
      sectionRoles,
      formalGroup,
      formalRank,
      independentRank,
      urlBuilder: this.r2StorageService,
    });
  }

  /**
   * FormalRankService.getCurrentOrNull resolves "the row with endedOn =
   * null", but UserProfileService.endFormalGroup only ends the
   * FormalGroupAffiliation row - it does NOT end the corresponding
   * FormalRankAssignment (see that method's own comment). That means a
   * user who has left their formal Group would otherwise keep showing
   * their old formal-group rank here forever. This gate gives the public-
   * profile surface its own, narrower notion of "current": the assignment
   * only counts if the target still has a *matching* active
   * FormalGroupAffiliation for the exact same sourceGroup. Deliberately
   * local to this method only - it does not touch FormalRankAssignment
   * itself or FormalRankService, so GET /users/me/formal-rank and every
   * other caller of getCurrentOrNull/getCurrent are unaffected.
   */
  private async resolvePublicFormalRank(
    targetId: string,
  ): Promise<FormalRankAssignment | null> {
    const assignment = await this.formalRankService.getCurrentOrNull(targetId);
    if (!assignment) {
      return null;
    }
    const hasMatchingActiveAffiliation =
      (await this.em.count(FormalGroupAffiliation, {
        user: targetId,
        group: assignment.sourceGroup.id,
        endedOn: null,
      })) > 0;
    return hasMatchingActiveAffiliation ? assignment : null;
  }

  /**
   * GET /users/search - a minimal, global (not Section-scoped) user picker,
   * currently only needed to pick a Training's external trainer. Matches
   * against exactly four public fields: numericCode (exact), publicCode
   * (prefix), firstName/lastName and apelido (substring) - basic identity
   * has no privacy toggle, so all of them are always searchable. Never
   * touches `User.displayName` (see resolveDisplayName). A single
   * `em.findAndCount` - no fetch-all-then-filter-in-JS.
   */
  async searchUsers(
    search: string,
    limit: number,
    offset: number,
  ): Promise<UserSearchListResponseDto> {
    const trimmed = search.trim();
    const numericCode = normalizeNumericCodeInput(trimmed);

    if (!numericCode && trimmed.length < SEARCH_TEXT_MIN_LENGTH) {
      throw new BadRequestException({
        code: 'SEARCH_TOO_SHORT',
        message: `search must be at least ${SEARCH_TEXT_MIN_LENGTH} characters, or an exact numeric code`,
      });
    }

    const orConditions: FilterQuery<User>[] = [];
    if (numericCode) {
      orConditions.push({ numericCode });
    }
    if (trimmed.length >= SEARCH_TEXT_MIN_LENGTH) {
      orConditions.push({ publicCode: { $ilike: `${trimmed}%` } });
      orConditions.push({ firstName: { $ilike: `%${trimmed}%` } });
      orConditions.push({ lastName: { $ilike: `%${trimmed}%` } });
      orConditions.push({ apelido: { $ilike: `%${trimmed}%` } });
    }

    const [users, total] = await this.em.findAndCount(
      User,
      { $or: orConditions },
      { limit, offset, orderBy: { numericCode: 'asc' } },
    );

    return {
      items: users.map(toUserSearchResultDto),
      total,
      hasMore: offset + users.length < total,
    };
  }

  /**
   * Sets/changes the caller's single formal Group affiliation - see
   * formal-group-affiliation.entity.ts. The Group itself must be ACTIVE.
   * Then one of two paths, decided here (never by the client):
   *
   *  - Immediate (Group.joinRequiresApproval off, or the caller is the
   *    Group's own OWNER/ADMIN): the current affiliation ends and a fresh
   *    row starts atomically (switchFormalGroup). Requires an ACTIVE/
   *    READ_ONLY SectionMembership in at least one ACTIVE Section anywhere
   *    in the Group's hierarchy (direct or under a nested child Group - see
   *    GroupHierarchyService.getDescendantSections), unless the caller is
   *    the Group's OWNER/ADMIN. Any pending Group join request elsewhere
   *    becomes moot and is cancelled.
   *  - Approval (joinRequiresApproval on): nothing about the current
   *    affiliation changes yet - a PENDING Group join request is created
   *    instead (MembershipRequestsService.createGroupJoinRequest) and the
   *    switch only happens on approval. No Section membership is required:
   *    the reviewer's decision replaces it. startedOn is not carried over
   *    (the affiliation then starts with startedOn = null).
   *
   * Either path refuses to move an OWNER off their own Group
   * (OWNER_MUST_STAY_IN_FORMAL_GROUP). Validated at set/request time only -
   * see the entity's own comment on why an affiliation never ends itself
   * automatically.
   */
  async setFormalGroup(
    user: User,
    groupId: string,
    startedOnInput?: string,
  ): Promise<FormalGroupResponseDto | PendingFormalGroupRequestResponseDto> {
    const startedOn = startedOnInput ? parseDateOnly(startedOnInput) : null;
    if (startedOn && startedOn.getTime() > startOfTodayUtc().getTime()) {
      throw new BadRequestException({
        code: 'FORMAL_GROUP_STARTED_ON_IN_FUTURE',
        message: 'startedOn cannot be in the future',
      });
    }

    return this.em.transactional(async (em) => {
      const group = await em.findOne(Group, { id: groupId });
      if (!group) {
        throw this.formalGroupNotFound();
      }
      if (group.status !== GroupStatus.ACTIVE) {
        throw new ConflictException({
          code: 'FORMAL_GROUP_NOT_ACTIVE',
          message: 'This group is not currently active',
        });
      }

      // The Group's own OWNER is its formal member by definition (see
      // owner-formal-group.ts); its ADMIN already holds the very
      // permission that approves Group join requests. Neither needs a
      // Section membership nor anyone's approval.
      const ownsThisGroup = (await findOwnedLiveGroupIds(em, user.id)).includes(
        groupId,
      );
      const administersThisGroup =
        ownsThisGroup ||
        (await em.count(RoleAssignment, {
          user: user.id,
          group: groupId,
          role: GroupRole.ADMIN,
          revokedAt: null,
        })) > 0;

      const current = await em.findOne(FormalGroupAffiliation, {
        user: user.id,
        endedOn: null,
      });
      const isAlreadyThisGroup = current?.group.id === groupId;

      if (
        group.joinRequiresApproval &&
        !administersThisGroup &&
        !isAlreadyThisGroup
      ) {
        // Fails early what approval would refuse anyway.
        await assertNotLeavingOwnedGroup(
          em,
          user.id,
          current?.group.id ?? null,
          groupId,
        );
        const pendingRequest =
          await this.membershipRequestsService.createGroupJoinRequest(
            em,
            group,
            user,
          );
        return { pendingRequest };
      }

      if (!administersThisGroup && !isAlreadyThisGroup) {
        const descendantSections =
          await this.groupHierarchyService.getDescendantSections(groupId, em);
        const activeSectionIds = descendantSections
          .filter((section) => section.status === GroupStatus.ACTIVE)
          .map((section) => section.id);

        const hasQualifyingMembership =
          activeSectionIds.length > 0 &&
          (await em.count(SectionMembership, {
            user: user.id,
            section: { $in: activeSectionIds },
            status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
          })) > 0;

        if (!hasQualifyingMembership) {
          throw new ConflictException({
            code: 'FORMAL_GROUP_REQUIRES_ACTIVE_SECTION_MEMBERSHIP',
            message:
              'You must have an active section membership within this group (or one of its active sections) to set it as your formal group',
          });
        }
      }

      const affiliation = await switchFormalGroup(em, user, group, startedOn);
      await cancelPendingGroupJoinRequests(em, user, null);
      return toFormalGroupResponseDto(affiliation);
    });
  }

  async endFormalGroup(user: User): Promise<void> {
    const current = await this.em.findOne(FormalGroupAffiliation, {
      user: user.id,
      endedOn: null,
    });
    if (!current) {
      throw new NotFoundException({
        code: 'FORMAL_GROUP_NOT_SET',
        message: 'No active formal group affiliation to end',
      });
    }
    // An OWNER can't leave their own Group's formal membership - ownership
    // has to be transferred first (OWNER_MUST_STAY_IN_FORMAL_GROUP).
    await assertNotLeavingOwnedGroup(this.em, user.id, current.group.id, null);
    current.endedOn = startOfTodayUtc();
    await this.em.flush();
  }

  private async loadActiveFormalGroup(
    userId: string,
  ): Promise<FormalGroupAffiliation | null> {
    return this.em.findOne(
      FormalGroupAffiliation,
      { user: userId, endedOn: null },
      { populate: ['group'] },
    );
  }

  private async loadActiveSections(userId: string): Promise<Section[]> {
    const memberships = await this.em.find(
      SectionMembership,
      { user: userId, status: { $in: ACTIVE_MEMBERSHIP_STATUSES } },
      { populate: ['section'] },
    );
    return memberships.map((membership) => membership.section);
  }

  /**
   * The target's Role(s) per Section id, for exactly the Sections already
   * resolved by loadActiveSections above - same source
   * (RoleAssignmentsService.getGroupParticipationForUsers) and same
   * membership+MEMBER-role pairing invariant CommunityHomeService relies on
   * (see community-home.service.ts's buildParticipation), just for a single
   * target user instead of the caller. Filtered to `sectionIds` since
   * getGroupParticipationForUsers also returns the target's Group-level
   * roles (e.g. OWNER/ADMIN of a Group they administer), which must never
   * leak onto the public profile's Section list (see
   * public-user-profile-response.dto.ts's own "no `groups` field" note).
   */
  private async loadSectionRoles(
    userId: string,
    sectionIds: string[],
  ): Promise<Map<string, GroupRole[]>> {
    if (sectionIds.length === 0) {
      return new Map();
    }
    const participation =
      await this.roleAssignmentsService.getGroupParticipationForUsers([userId]);
    const sectionIdSet = new Set(sectionIds);
    const roles = new Map<string, GroupRole[]>();
    for (const row of participation) {
      if (sectionIdSet.has(row.groupId)) {
        roles.set(row.groupId, row.roles);
      }
    }
    return roles;
  }

  private userNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  }

  private formalGroupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'FORMAL_GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
