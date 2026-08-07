import { buildUserQrPayload } from '../common/identity/qr-payload.util';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { FormalGroupResponseDto } from './dto/formal-group-response.dto';
import {
  OwnFormalGroupRefDto,
  UserProfileResponseDto,
} from './dto/user-profile-response.dto';
import {
  PublicFormalGroupRefDto,
  PublicSectionRefDto,
  PublicUserProfileResponseDto,
} from './dto/public-user-profile-response.dto';
import { User } from './entities/user.entity';
import { Section } from '../groups/entities/section.entity';

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
): UserProfileResponseDto {
  return {
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    apelido: user.apelido,
    city: user.city,
    country: user.country,
    capoeiraStartedAt: toDateOnly(user.capoeiraStartedAt),
    profileComplete: user.firstName !== null && user.lastName !== null,
    privacy: {
      showFullName: user.showFullName,
      showApelido: user.showApelido,
      showLocation: user.showLocation,
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
    qrPayload: buildUserQrPayload(user.numericCode),
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
// DTO, it never decides what is visible.
export interface PublicProfileViewerContext {
  canSeeFullName: boolean;
  canSeeApelido: boolean;
  canSeeLocation: boolean;
  canSeeCapoeiraStartedAt: boolean;
  sections: Section[] | null;
  formalGroup: FormalGroupAffiliation | null;
}

export function toPublicUserProfileResponseDto(
  target: User,
  ctx: PublicProfileViewerContext,
): PublicUserProfileResponseDto {
  const fullNameKnown =
    ctx.canSeeFullName && target.firstName !== null && target.lastName !== null;
  const apelidoKnown = ctx.canSeeApelido && target.apelido !== null;

  return {
    userId: target.id,
    displayName: resolveDisplayName(target, fullNameKnown, apelidoKnown),
    firstName: fullNameKnown ? target.firstName : null,
    lastName: fullNameKnown ? target.lastName : null,
    apelido: apelidoKnown ? target.apelido : null,
    city: ctx.canSeeLocation ? target.city : null,
    country: ctx.canSeeLocation ? target.country : null,
    capoeiraStartedAt: ctx.canSeeCapoeiraStartedAt
      ? toDateOnly(target.capoeiraStartedAt)
      : null,
    sections: ctx.sections ? ctx.sections.map(toPublicSectionRefDto) : null,
    formalGroup: ctx.formalGroup
      ? toPublicFormalGroupRefDto(ctx.formalGroup)
      : null,
  };
}

// Never `User.displayName` - that field can already hold a real name today
// (nothing stops a user from setting it to one), so reusing it here could
// silently bypass showFullName=false. Falls through: full name (if
// visible) -> apelido (if visible) -> the raw publicCode, with no
// localized/templated wrapper text (that's a frontend concern).
function resolveDisplayName(
  target: User,
  fullNameKnown: boolean,
  apelidoKnown: boolean,
): string {
  if (fullNameKnown) {
    return `${target.firstName} ${target.lastName}`;
  }
  if (apelidoKnown && target.apelido) {
    return target.apelido;
  }
  return target.publicCode;
}

function toPublicSectionRefDto(section: Section): PublicSectionRefDto {
  return { id: section.id, name: section.name };
}

function toPublicFormalGroupRefDto(
  affiliation: FormalGroupAffiliation,
): PublicFormalGroupRefDto {
  return { id: affiliation.group.id, name: affiliation.group.name };
}
