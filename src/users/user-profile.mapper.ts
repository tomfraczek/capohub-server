import { buildUserQrPayload } from '../common/identity/qr-payload.util';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { CustomUserRank } from '../graduation/entities/custom-user-rank.entity';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import {
  PublicUrlBuilder,
  resolveImageUrl,
  resolveUserAvatarUrl,
} from '../storage/image-url.util';
import { FormalGroupResponseDto } from './dto/formal-group-response.dto';
import {
  OwnFormalGroupRefDto,
  UserProfileResponseDto,
} from './dto/user-profile-response.dto';
import {
  PublicFormalGroupRefDto,
  PublicFormalRankRefDto,
  PublicIndependentRankRefDto,
  PublicSectionRefDto,
  PublicSectionRoleDto,
  PublicUserProfileResponseDto,
} from './dto/public-user-profile-response.dto';
import { UserSearchResultDto } from './dto/user-search-result.dto';
import { resolveDisplayName } from './display-name.util';
import { User } from './entities/user.entity';
import { Section } from '../groups/entities/section.entity';

const PUBLIC_SECTION_ROLES: ReadonlySet<GroupRole> = new Set<GroupRole>([
  GroupRole.INSTRUCTOR,
  GroupRole.ASSISTANT,
]);

// Narrows a Section's full RoleAssignment roles (which can include OWNER/
// ADMIN - app-authorization facts) down to only the capoeira-representative
// ones a profile should ever show - see PublicSectionRoleDto's own comment.
// The one and only place this filtering happens; UserProfileService never
// re-derives or duplicates this list.
function toPublicSectionRoles(roles: GroupRole[]): PublicSectionRoleDto[] {
  return roles.filter((role): role is PublicSectionRoleDto =>
    PUBLIC_SECTION_ROLES.has(role),
  );
}

// MikroORM's postgres driver returns a `date` column as a plain
// "YYYY-MM-DD" string at runtime, not a Date instance, despite the
// entity's TS type - this normalizes either shape to that same date-only
// string, never a full timestamp, since these fields never carry a time
// component.
function toDateOnly(date: Date | string | null): string | null {
  if (!date) {
    return null;
  }
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}

export function toUserProfileResponseDto(
  user: User,
  activeFormalGroup: FormalGroupAffiliation | null,
  publicWebBaseUrl?: string,
): UserProfileResponseDto {
  return {
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    apelido: user.apelido,
    capoeiraStartedAt: toDateOnly(user.capoeiraStartedAt),
    birthDate: toDateOnly(user.birthDate),
    phoneNumber: user.phoneNumber,
    gender: user.gender,
    profileComplete: user.firstName !== null && user.lastName !== null,
    privacy: {
      showCapoeiraStartedAt: user.showCapoeiraStartedAt,
      showSections: user.showSections,
      showFormalGroup: user.showFormalGroup,
      showFormalRank: user.showFormalRank,
      showCareerTimeline: user.showCareerTimeline,
      showEventParticipation: user.showEventParticipation,
    },
    formalGroup: activeFormalGroup
      ? toOwnFormalGroupRefDto(activeFormalGroup)
      : null,
    numericCode: user.numericCode,
    qrPayload: buildUserQrPayload(user.numericCode, publicWebBaseUrl),
  };
}

function toOwnFormalGroupRefDto(
  affiliation: FormalGroupAffiliation,
): OwnFormalGroupRefDto {
  return {
    groupId: affiliation.group.id,
    name: affiliation.group.name,
    startedOn: toDateOnly(affiliation.startedOn),
    endedOn: toDateOnly(affiliation.endedOn),
  };
}

export function toFormalGroupResponseDto(
  affiliation: FormalGroupAffiliation,
): FormalGroupResponseDto {
  return {
    groupId: affiliation.group.id,
    name: affiliation.group.name,
    startedOn: toDateOnly(affiliation.startedOn),
    endedOn: toDateOnly(affiliation.endedOn),
  };
}

// Params are the already-computed visibility decisions (see
// UserProfileService.getPublicProfile) - this function only assembles the
// DTO, it never decides what is visible. First name, last name and apelido
// are not among them: basic identity is never privacy-gated.
export interface PublicProfileViewerContext {
  canSeeCapoeiraStartedAt: boolean;
  sections: Section[] | null;
  // The target's Role(s) per Section id, already scoped to `sections` -
  // see UserProfileService.loadSectionRoles. A Section id missing from this
  // map (should not happen given the membership+MEMBER-role pairing
  // invariant, but mapped defensively) renders as an empty roles array
  // rather than throwing.
  sectionRoles: Map<string, GroupRole[]>;
  formalGroup: FormalGroupAffiliation | null;
  formalRank: FormalRankAssignment | null;
  independentRank: CustomUserRank | null;
  urlBuilder: PublicUrlBuilder;
}

export function toPublicUserProfileResponseDto(
  target: User,
  ctx: PublicProfileViewerContext,
): PublicUserProfileResponseDto {
  return {
    userId: target.id,
    displayName: resolveDisplayName(target),
    avatarType: target.avatarType,
    avatarUrl: resolveUserAvatarUrl(target, ctx.urlBuilder),
    presetAvatarId: target.presetAvatarId,
    firstName: target.firstName,
    lastName: target.lastName,
    apelido: target.apelido,
    capoeiraStartedAt: ctx.canSeeCapoeiraStartedAt
      ? toDateOnly(target.capoeiraStartedAt)
      : null,
    sections: ctx.sections
      ? ctx.sections.map((section) =>
          toPublicSectionRefDto(
            section,
            ctx.sectionRoles.get(section.id) ?? [],
            ctx.urlBuilder,
          ),
        )
      : null,
    formalGroup: ctx.formalGroup
      ? toPublicFormalGroupRefDto(ctx.formalGroup)
      : null,
    formalRank: ctx.formalRank
      ? toPublicFormalRankRefDto(ctx.formalRank)
      : null,
    independentRank: ctx.independentRank
      ? toPublicIndependentRankRefDto(ctx.independentRank)
      : null,
  };
}

function toPublicSectionRefDto(
  section: Section,
  roles: GroupRole[],
  urlBuilder: PublicUrlBuilder,
): PublicSectionRefDto {
  return {
    id: section.id,
    name: section.name,
    roles: toPublicSectionRoles(roles),
    logoUrl: resolveImageUrl(
      section.profileImageKey,
      section.logoUrl,
      urlBuilder,
    ),
  };
}

function toPublicFormalGroupRefDto(
  affiliation: FormalGroupAffiliation,
): PublicFormalGroupRefDto {
  return { id: affiliation.group.id, name: affiliation.group.name };
}

// Requires `rank.cordSegments` and `sourceGroup` to have been populated -
// same assumption as toFormalRankAssignmentResponseDto (see
// FormalRankService.RANK_POPULATE). Deliberately narrower than that DTO -
// no assignment id, awardedByName, isCurrent (always true here - only the
// current assignment is ever loaded, see getCurrentOrNull) or event, per
// the "only what's needed" scope for the public surface.
function toPublicFormalRankRefDto(
  assignment: FormalRankAssignment,
): PublicFormalRankRefDto {
  return {
    name: assignment.rank.name,
    cordSegments: [...assignment.rank.cordSegments.getItems()]
      .sort((a, b) => a.position - b.position)
      .map((segment) => ({
        position: segment.position,
        colorHex: segment.colorHex,
        proportion: segment.proportion,
      })),
    sourceGroup: assignment.sourceGroup
      ? { id: assignment.sourceGroup.id, name: assignment.sourceGroup.name }
      : null,
    startedOn: toDateOnly(assignment.startedOn),
  };
}

// Requires `cordSegments` to have been populated - same assumption as
// toPublicFormalRankRefDto above (see
// CustomUserRankService.getCurrentOrNull). Deliberately narrower than
// CustomUserRankResponseDto - no id, description, createdAt/updatedAt, per
// the same "only what's needed" scope.
function toPublicIndependentRankRefDto(
  customRank: CustomUserRank,
): PublicIndependentRankRefDto {
  return {
    name: customRank.name,
    track: customRank.track,
    cordSegments: [...customRank.cordSegments.getItems()]
      .sort((a, b) => a.position - b.position)
      .map((segment) => ({
        position: segment.position,
        colorHex: segment.colorHex,
        proportion: segment.proportion,
      })),
  };
}

// GET /users/search result row. `numericCode` is always included - it's a
// public identifier by design (see numeric-code.ts), not privacy-gated.
export function toUserSearchResultDto(target: User): UserSearchResultDto {
  return {
    id: target.id,
    displayName: resolveDisplayName(target),
    numericCode: target.numericCode,
  };
}
