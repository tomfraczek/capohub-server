import { User } from './entities/user.entity';
import { DisplayNameMode } from './enums/display-name-mode.enum';

// What resolveDisplayName reads. The preference/rank/privacy fields are
// optional so a partially-built user (a test fixture, or a reference that
// never went through a full load) still resolves - a missing
// displayNameMode reads as the FULL_NAME default, a missing
// currentRankTitle as "no title".
export type DisplayNameSource = Pick<
  User,
  'firstName' | 'lastName' | 'apelido' | 'publicCode'
> &
  Partial<
    Pick<User, 'displayNameMode' | 'currentRankTitle' | 'showFormalRank'>
  >;

// The label shown for a user wherever the app presents them as a person
// to someone else - the one place DisplayNameMode is applied, so every
// endpoint (lists, authors, organizers, notification texts...) agrees.
//
//  - FULL_NAME (default): "Imię Nazwisko".
//  - TITLE_APELIDO: "<current rank name> <apelido>" ("Graduado Lagarto");
//    just the apelido when there is no current rank or the user hides it
//    (showFormalRank - the same toggle that hides the rank on their
//    profile, so the name never leaks a rank the profile keeps private);
//    no apelido at all -> falls back to FULL_NAME. The title is only ever
//    the real rank name (User.currentRankTitle) - never invented or
//    derived from cord colors.
//
// FULL_NAME's own fallbacks are unchanged: apelido when the full name is
// not set yet, else the publicCode - only ever reached by an account that
// has not filled in a name at all (profileComplete=false), never as a
// stand-in for a name that exists. The preference belongs to the person
// shown, never the viewer, so nothing here depends on the viewer. Never
// `User.displayName` (the separate, email-seeded account label). No
// localized/templated wrapper text - that's a frontend concern. A
// dependency-free helper so every module can share one rule.
export function resolveDisplayName(target: DisplayNameSource): string {
  if (target.displayNameMode === DisplayNameMode.TITLE_APELIDO) {
    const titled = resolveTitleAndApelido(target);
    if (titled) {
      return titled;
    }
  }
  return resolveFullName(target);
}

// Both variants side by side, for the owner's own settings preview (see
// UserProfileResponseDto.displayNameVariants) - computed by the exact same
// rules as resolveDisplayName, so the preview can never disagree with
// what other users actually see.
export function resolveDisplayNameVariants(
  target: DisplayNameSource,
): Record<DisplayNameMode, string> {
  return {
    [DisplayNameMode.FULL_NAME]: resolveDisplayName({
      ...target,
      displayNameMode: DisplayNameMode.FULL_NAME,
    }),
    [DisplayNameMode.TITLE_APELIDO]: resolveDisplayName({
      ...target,
      displayNameMode: DisplayNameMode.TITLE_APELIDO,
    }),
  };
}

// FULL_NAME regardless of the user's own DisplayNameMode - only for the
// full profile screen (PublicUserProfileResponseDto), which deliberately
// keeps its own layout (name, apelido, rank, title each in their place)
// and is not a "how others address me" surface.
export function resolveFullName(target: DisplayNameSource): string {
  if (target.firstName && target.lastName) {
    return `${target.firstName} ${target.lastName}`;
  }
  if (target.apelido) {
    return target.apelido;
  }
  // `?? ''` only for an unloaded reference (no columns at all) - never a
  // real, loaded account, whose publicCode is NOT NULL.
  return target.publicCode ?? '';
}

function resolveTitleAndApelido(target: DisplayNameSource): string | null {
  if (!target.apelido) {
    return null;
  }
  // showFormalRank is a plain boolean defaulting to true on the entity -
  // only an explicit `false` hides the title.
  const title =
    target.showFormalRank === false ? null : target.currentRankTitle?.trim();
  return title ? `${title} ${target.apelido}` : target.apelido;
}
