import { UserGender } from '../users/enums/user-gender.enum';

export interface RankNames {
  name: string;
  nameFemale: string | null;
}

/**
 * The title of a rank as held by one specific person - it follows the
 * holder's gender, never the viewer's. FEMALE gets `nameFemale`; MALE,
 * UNDISCLOSED and a not-yet-set gender (null) get `name`, the masculine/
 * default form. A rank without a feminine form yet (created before the
 * field existed) shows `name` to everyone - never an empty title.
 *
 * Same rule as the User.currentRankTitle formula (user.entity.ts), which
 * applies it in SQL.
 */
export function resolveRankName(
  rank: RankNames,
  gender: UserGender | null | undefined,
): string {
  return gender === UserGender.FEMALE && rank.nameFemale
    ? rank.nameFemale
    : rank.name;
}
